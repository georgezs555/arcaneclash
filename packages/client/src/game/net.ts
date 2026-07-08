// WebSocket-backed controller for online play. The server is authoritative:
// we pre-validate locally for instant feedback, send the action, and adopt
// whatever state the server broadcasts back.
//
// Reconnect: the server hands us a rejoin token at match start. We keep it in
// sessionStorage so a page refresh (or a dropped socket) can reclaim the seat
// during the server's grace period instead of forfeiting.

import {
  validateAction,
  type Action,
  type GameState,
  type PlayerIndex,
} from "@arcaneclash/engine";
import type { Controller, GameEvent } from "./controller";

export type NetStatus = "connecting" | "waiting" | "playing" | "closed" | "failed";

const MATCH_KEY = "arcaneclash.pendingMatch";
const RECONNECT_DELAY_MS = 1500;
const MAX_RECONNECT_ATTEMPTS = 8;

/** Rejoin token of a match this browser tab is still part of, if any. */
export function getPendingMatch(): string | null {
  try {
    return sessionStorage.getItem(MATCH_KEY);
  } catch {
    return null;
  }
}

function storePendingMatch(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(MATCH_KEY, token);
    else sessionStorage.removeItem(MATCH_KEY);
  } catch {
    // storage unavailable; refresh-rejoin just won't work
  }
}

type ServerMsg =
  | { type: "waiting" }
  | {
      type: "start";
      seat: PlayerIndex;
      names: [string, string];
      state: GameState;
      rejoinToken: string;
    }
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
  private rejoinToken: string | null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly url: string,
    private readonly playerName: string,
    private readonly deck?: { cards: string[]; heroId: string },
    private readonly token?: string,
    rejoin?: string,
  ) {
    this.rejoinToken = rejoin ?? null;
  }

  start(): void {
    if (this.ws || this.destroyed) return;
    this.connect();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    // Leaving a live match on purpose abandons the seat.
    if (this.status === "playing" && this.state?.phase !== "gameover") {
      storePendingMatch(null);
    }
    this.listeners.clear();
    this.statusListeners.clear();
    try {
      this.ws?.close();
    } catch {
      // already closed
    }
  }

  private connect(): void {
    if (this.destroyed) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          type: "join",
          name: this.playerName,
          token: this.token,
          rejoin: this.rejoinToken ?? undefined,
          deck: this.deck
            ? { cards: this.deck.cards, heroId: this.deck.heroId }
            : undefined,
        }),
      );
    ws.onmessage = (e) => this.onMsg(JSON.parse(String(e.data)) as ServerMsg);
    ws.onerror = () => {
      // onclose follows and owns the recovery/failed transition
    };
    ws.onclose = () => this.handleClose();
  }

  private handleClose(): void {
    if (this.destroyed) return;
    this.ws = null;

    // Mid-match drop with a rejoin token: keep the game view and retry.
    if (
      this.status === "playing" &&
      this.state?.phase !== "gameover" &&
      this.rejoinToken
    ) {
      if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts += 1;
        this.emit({
          state: this.state,
          error: `Connection lost — reconnecting (${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})…`,
        });
        this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
        return;
      }
      storePendingMatch(null);
      this.emit({ state: this.state, error: "Connection to server lost" });
      this.setStatus("closed");
      return;
    }

    if (this.status === "playing") {
      this.setStatus("closed");
    } else if (this.status !== "failed") {
      this.setStatus("failed");
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
    if (this.status !== "playing") return "Not connected";
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) {
      return "Reconnecting to the server…";
    }
    if (this.state.phase === "gameover") return "Game is over";
    if (action.player !== this.seat) return "It's not your turn";
    // Mulligan is submitted by both players; everything else needs the turn.
    if (
      action.type !== "MULLIGAN" &&
      (this.state.phase !== "playing" || this.state.active !== this.seat)
    ) {
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
        this.rejoinToken = msg.rejoinToken;
        this.reconnectAttempts = 0;
        storePendingMatch(msg.rejoinToken);
        this.setStatus("playing");
        this.emit({ state: this.state });
        break;
      case "update":
        this.state = msg.state;
        if (msg.state.phase === "gameover") storePendingMatch(null);
        this.emit({ state: this.state, action: msg.action });
        break;
      case "error":
        if (this.status === "playing" && this.state) {
          this.emit({ state: this.state, error: msg.message });
        } else if (this.rejoinToken) {
          // Rejoin was rejected (match ended or seat reclaimed): give up.
          this.rejoinToken = null;
          storePendingMatch(null);
          this.setStatus("failed");
        }
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
