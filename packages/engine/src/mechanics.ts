// Low-level state mutators shared by card effects and the game state machine.
// These operate directly on a GameState (usually a clone made in applyAction).

import { getCardDef } from "./registry";
import type {
  CardInstance,
  CharRef,
  GameState,
  HeroState,
  PlayerIndex,
  Keyword,
} from "./types";

export const MAX_BOARD = 7;
export const MAX_HAND = 10;
export const MAX_MANA = 10;
export const START_HEALTH = 30;

/** Deterministic RNG (LCG) bound to the game state, so replays/multiplayer stay in sync. */
export function makeRng(state: GameState): () => number {
  return () => {
    state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
    return state.rng / 0x100000000;
  };
}

export function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function other(p: PlayerIndex): PlayerIndex {
  return (p === 0 ? 1 : 0) as PlayerIndex;
}

export function hasKeyword(m: CardInstance, k: Keyword): boolean {
  return m.keywords.includes(k);
}

export function createInstance(
  state: GameState,
  defId: string,
  owner: PlayerIndex,
): CardInstance {
  const def = getCardDef(defId);
  const keywords = [...(def.keywords ?? [])];
  return {
    instanceId: `c${state.nextInstanceId++}`,
    defId,
    owner,
    attack: def.attack ?? 0,
    health: def.health ?? 0,
    maxHealth: def.health ?? 0,
    keywords,
    divineShield: keywords.includes("divineShield"),
    summonedThisTurn: true,
    attacksThisTurn: 0,
    frozen: false,
  };
}

type Resolved =
  | { hero: HeroState; minion?: undefined; owner: PlayerIndex }
  | { minion: CardInstance; hero?: undefined; owner: PlayerIndex };

/** Resolve a CharRef to the live hero/minion object plus its controller. */
export function resolve(state: GameState, ref: CharRef): Resolved | null {
  if (ref.kind === "hero") {
    return { hero: state.players[ref.player].hero, owner: ref.player };
  }
  for (const p of [0, 1] as const) {
    const m = state.players[p].board.find((x) => x.instanceId === ref.instanceId);
    if (m) return { minion: m, owner: p };
  }
  return null;
}

export function dealDamage(state: GameState, ref: CharRef, amount: number): void {
  if (amount <= 0) return;
  const t = resolve(state, ref);
  if (!t) return;
  if (t.minion) {
    if (t.minion.divineShield) {
      t.minion.divineShield = false;
      return;
    }
    t.minion.health -= amount;
  } else {
    let dmg = amount;
    if (t.hero.armor > 0) {
      const absorbed = Math.min(t.hero.armor, dmg);
      t.hero.armor -= absorbed;
      dmg -= absorbed;
    }
    t.hero.health -= dmg;
  }
}

export function healChar(state: GameState, ref: CharRef, amount: number): void {
  if (amount <= 0) return;
  const t = resolve(state, ref);
  if (!t) return;
  if (t.minion) {
    t.minion.health = Math.min(t.minion.maxHealth, t.minion.health + amount);
  } else {
    t.hero.health = Math.min(t.hero.maxHealth, t.hero.health + amount);
  }
}

export function buff(state: GameState, ref: CharRef, atk: number, hp: number): void {
  const t = resolve(state, ref);
  if (!t?.minion) return;
  t.minion.attack += atk;
  t.minion.maxHealth += hp;
  t.minion.health += hp;
}

/** Frozen minions can't attack; they thaw at the end of their owner's turn. */
export function freezeMinion(state: GameState, ref: CharRef): void {
  const t = resolve(state, ref);
  if (t?.minion) t.minion.frozen = true;
}

export function giveDivineShield(state: GameState, ref: CharRef): void {
  const t = resolve(state, ref);
  if (!t?.minion) return;
  t.minion.divineShield = true;
  if (!t.minion.keywords.includes("divineShield")) {
    t.minion.keywords.push("divineShield");
  }
}

export function setMinionAttack(state: GameState, ref: CharRef, value: number): void {
  const t = resolve(state, ref);
  if (t?.minion) t.minion.attack = value;
}

export function drawCard(state: GameState, p: PlayerIndex): CardInstance | null {
  const pl = state.players[p];
  const card = pl.deck.pop();
  if (!card) {
    pl.fatigue += 1;
    dealDamage(state, { kind: "hero", player: p }, pl.fatigue);
    return null;
  }
  if (pl.hand.length >= MAX_HAND) {
    // Hand full: the card is "burned" (discarded).
    return null;
  }
  pl.hand.push(card);
  return card;
}

export function summonMinion(
  state: GameState,
  p: PlayerIndex,
  defId: string,
  position?: number,
): CardInstance | null {
  const pl = state.players[p];
  if (pl.board.length >= MAX_BOARD) return null;
  const inst = createInstance(state, defId, p);
  const pos =
    position == null
      ? pl.board.length
      : Math.max(0, Math.min(position, pl.board.length));
  pl.board.splice(pos, 0, inst);
  return inst;
}

/** Remove dead minions (firing deathrattles) and detect a finished game. */
export function resolveDeaths(state: GameState): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of [0, 1] as const) {
      const board = state.players[p].board;
      for (let i = 0; i < board.length; i++) {
        if (board[i].health <= 0) {
          const [dead] = board.splice(i, 1);
          i--;
          const def = getCardDef(dead.defId);
          if (def.deathrattle) {
            def.deathrattle({
              state,
              controller: p,
              source: dead,
              target: null,
              rng: makeRng(state),
            });
          }
          changed = true;
        }
      }
    }
  }

  if (state.phase === "gameover") return;
  const dead0 = state.players[0].hero.health <= 0;
  const dead1 = state.players[1].hero.health <= 0;
  if (dead0 || dead1) {
    state.phase = "gameover";
    state.winner = dead0 && dead1 ? "draw" : dead0 ? 1 : 0;
  }
}
