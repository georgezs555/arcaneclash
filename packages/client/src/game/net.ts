// WebSocket-backed controller for online play. The server is authoritative:
// we pre-validate locally for instant feedback, send the action, and adopt
// whatever state the server broadcasts back.

import {
  validateAction,
  type Action,
  type GameState,
  type PlayerIndex,
} from "@arcaneclash/engine";
import type { Controller, GameEvent } from "./controller";

export type NetStatus = "connecting" | "waiting" | "playing" | "closed" | "failed";

type ServerMsg =
  | { type: "waiting" }
  | { type: "start"; seat: PlayerIndex; names: [string, string]; state: GameState }
  | { type: "update"; state: GameState; action?: Action }
  | { type: "error"; message: string };

export class NetController implements Controller {
  state!: GameState;
  readonly modeLabel = "online" as const;
  status: NetStatus = "connecting";

  private seat: PlayerIndex = 0;
  private names: [string, string] = ["Player 1", "Player 2"];
  private ws: WebSocket | null = null;
  private listeners = new Set<(ev: GameEvent) => void>();
  private statusListeners = new Set<(s: NetStatus) => void>();
  private destroyed = false;

  constructor(
    private readonly url: string,
    private readonly playerName: string,
    private readonly deck?: { cards: string[]; heroId: string },
    private readonly token?: string,
  ) {}

  start(): void {
    if (this.ws || this.destroyed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          type: "join",
          name: this.playerName,
          token: this.token,
          deck: this.deck
            ? { cards: this.deck.cards, heroId: this.deck.heroId }
            : undefined,
        }),
      );
    ws.onmessage = (e) => this.onMsg(JSON.parse(String(e.data)) as ServerMsg);
    ws.onerror = () => this.setStatus("failed");
    ws.onclose = () => {
      if (this.destroyed) return;
      if (this.status === "playing") {
        this.emit({ state: this.state, error: "Connection to server lost" });
        this.setStatus("closed");
      } else if (this.status !== "failed") {
        this.setStatus("failed");
      }
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
    this.statusListeners.clear();
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
  }

  bottomSeat(): PlayerIndex {
    return this.seat;
  }

  seatNames(): [string, string] {
    return this.names;
  }

  isHumanTurn(): boolean {
    return (
      this.status === "playing" &&
      this.state.phase === "playing" &&
      this.state.active === this.seat
    );
  }

  subscribe(fn: (ev: GameEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: (s: NetStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  trySubmit(action: Action): string | null {
    if (this.status !== "playing" || !this.ws) return "Not connected";
    if (this.state.phase !== "playing") return "Game is over";
    if (action.player !== this.seat || this.state.active !== this.seat) {
      return "It's not your turn";
    }
    const err = validateAction(this.state, action);
    if (err) {
      this.emit({ state: this.state, error: err });
      return err;
    }
    this.ws.send(JSON.stringify({ type: "action", action }));
    return null;
  }

  private onMsg(msg: ServerMsg): void {
    switch (msg.type) {
      case "waiting":
        this.setStatus("waiting");
        break;
      case "start":
        this.seat = msg.seat;
        this.names = msg.names;
        this.state = msg.state;
        this.setStatus("playing");
        this.emit({ state: this.state });
        break;
      case "update":
        this.state = msg.state;
        this.emit({ state: this.state, action: msg.action });
        break;
      case "error":
        if (this.state) this.emit({ state: this.state, error: msg.message });
        break;
    }
  }

  private emit(ev: GameEvent): void {
    for (const fn of this.listeners) fn(ev);
  }

  private setStatus(s: NetStatus): void {
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }
}
