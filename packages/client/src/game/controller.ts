// Bridges the pure engine to the UI: owns the authoritative local GameState,
// validates/applies player input, and drives the AI opponent with think-delays
// so animations have time to play. In milestone 2 this class is what gets
// replaced by a WebSocket client talking to the server.

import {
  allHeroes,
  applyAction,
  chooseAction,
  createGame,
  getHero,
  starterDeckFor,
  validateAction,
  type Action,
  type GameState,
  type PlayerIndex,
} from "@arcaneclash/engine";

export type Mode = "ai" | "hotseat";

export interface GameEvent {
  state: GameState;
  /** The action that produced this state, when there is one. */
  action?: Action;
  /** Set when a submitted action was rejected. */
  error?: string;
}

/**
 * What the game view needs from any source of game states — the local
 * engine-backed controller here, or the WebSocket-backed NetController.
 */
export interface Controller {
  readonly state: GameState;
  readonly modeLabel: "ai" | "hotseat" | "online";
  bottomSeat(): PlayerIndex;
  isHumanTurn(): boolean;
  seatNames(): [string, string];
  subscribe(fn: (ev: GameEvent) => void): () => void;
  start(): void;
  destroy(): void;
  trySubmit(action: Action): string | null;
}

const AI_SEAT: PlayerIndex = 1;
const AI_ACTION_DELAY_MS = 850;

export class GameController implements Controller {
  state: GameState;
  readonly mode: Mode;
  private listeners = new Set<(ev: GameEvent) => void>();
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    mode: Mode,
    deck?: { cards: string[]; heroId: string },
    seed?: number,
  ) {
    this.mode = mode;
    const mine = deck?.cards ?? starterDeckFor("merlin");
    const myHero = deck?.heroId ?? "merlin";
    // Hotseat is a mirror match with the chosen deck; the AI plays a random
    // hero with that hero's starter deck.
    const heroes = allHeroes();
    const aiHero = heroes[Math.floor(Math.random() * heroes.length)].id;
    this.state = createGame({
      decks:
        mode === "hotseat"
          ? [[...mine], [...mine]]
          : [[...mine], starterDeckFor(aiHero)],
      heroes: mode === "hotseat" ? [myHero, myHero] : [myHero, aiHero],
      seed,
    });
  }

  get modeLabel(): "ai" | "hotseat" {
    return this.mode;
  }

  seatNames(): [string, string] {
    if (this.mode === "ai") {
      const aiHero = getHero(this.state.players[1].heroId).name;
      return ["You", `${aiHero} (AI)`];
    }
    return ["Player 1", "Player 2"];
  }

  /** Which player the bottom of the screen belongs to. */
  bottomSeat(): PlayerIndex {
    if (this.mode === "hotseat") {
      if (this.state.phase === "mulligan") {
        // Players mulligan one after the other at the bottom seat.
        const idx = this.state.players.findIndex((p) => !p.mulliganDone);
        return (idx === -1 ? 0 : idx) as PlayerIndex;
      }
      return this.state.phase === "playing" ? this.state.active : 0;
    }
    return 0;
  }

  isHumanTurn(): boolean {
    if (this.state.phase !== "playing") return false;
    return this.mode === "hotseat" || this.state.active !== AI_SEAT;
  }

  subscribe(fn: (ev: GameEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Kick off AI scheduling (in case the AI goes first). */
  start(): void {
    this.maybeScheduleAI();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.listeners.clear();
  }

  /** Submit a human action. Returns an error message, or null on success. */
  trySubmit(action: Action): string | null {
    if (this.mode === "ai" && action.player === AI_SEAT) return "It's not your turn";
    // Mulligan bypasses the turn gate: both players submit during that phase.
    if (action.type !== "MULLIGAN" && !this.isHumanTurn()) {
      return "It's not your turn";
    }
    const err = validateAction(this.state, action);
    if (err) {
      this.emit({ state: this.state, error: err });
      return err;
    }
    this.apply(action);
    return null;
  }

  private apply(action: Action): void {
    this.state = applyAction(this.state, action);
    this.emit({ state: this.state, action });
    this.maybeScheduleAI();
  }

  private aiShouldAct(): boolean {
    if (this.state.phase === "mulligan") {
      return !this.state.players[AI_SEAT].mulliganDone;
    }
    return this.state.phase === "playing" && this.state.active === AI_SEAT;
  }

  private maybeScheduleAI(): void {
    if (this.mode !== "ai" || this.destroyed) return;
    if (!this.aiShouldAct()) return;
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = setTimeout(() => {
      if (this.destroyed || !this.aiShouldAct()) return;
      const action = chooseAction(this.state, AI_SEAT);
      this.apply(action);
    }, AI_ACTION_DELAY_MS);
  }

  private emit(ev: GameEvent): void {
    for (const fn of this.listeners) fn(ev);
  }
}
