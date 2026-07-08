// ArcaneClash server: an HTTP API for accounts/decks and an authoritative
// WebSocket match server, sharing one port. The engine validates every
// action and every submitted deck; each player receives a redacted view.

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import {
  applyAction,
  createGame,
  getHero,
  hasHero,
  other,
  redactState,
  starterDeckFor,
  validateAction,
  validateDeck,
  type Action,
  type GameState,
  type PlayerIndex,
} from "../../engine/src/index";
import {
  authenticate,
  getDecks,
  login,
  register,
  setDecks,
} from "./accounts";

const PORT = Number(process.env.PORT ?? 8787);
/** How long a disconnected player may reconnect before forfeiting. */
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS ?? 60_000);

// ---------------------------------------------------------------------------
// HTTP API (accounts + deck storage)
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function bearerUser(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return authenticate(header.slice(7));
}

async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const route = `${req.method} ${req.url}`;
  try {
    if (route === "POST /api/register" || route === "POST /api/login") {
      const body = (await readBody(req)) as { username?: unknown; password?: unknown };
      const result =
        route === "POST /api/register"
          ? register(body.username, body.password)
          : login(body.username, body.password);
      if ("error" in result) return json(res, 400, result);
      return json(res, 200, result);
    }

    if (req.url === "/api/decks") {
      const user = bearerUser(req);
      if (!user) return json(res, 401, { error: "Not logged in" });
      if (req.method === "GET") {
        return json(res, 200, { decks: getDecks(user) });
      }
      if (req.method === "PUT") {
        const body = (await readBody(req)) as { decks?: unknown };
        const err = setDecks(user, body.decks);
        if (err) return json(res, 400, { error: err });
        return json(res, 200, { ok: true });
      }
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    json(res, 400, { error: e instanceof Error ? e.message : "Bad request" });
  }
}

// ---------------------------------------------------------------------------
// Match server
// ---------------------------------------------------------------------------

type ClientMsg =
  | { type: "join"; name?: unknown; token?: unknown; deck?: unknown; rejoin?: unknown }
  | { type: "action"; action?: unknown };

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

interface DeckChoice {
  cards: string[];
  heroId: string;
}

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

/** Parse and validate a submitted deck; absent deck falls back to a starter. */
function parseDeck(raw: unknown): DeckChoice | { error: string } {
  if (raw == null) return { cards: starterDeckFor("merlin"), heroId: "merlin" };
  if (typeof raw !== "object") return { error: "Malformed deck" };
  const d = raw as { cards?: unknown; heroId?: unknown };
  if (
    !Array.isArray(d.cards) ||
    !d.cards.every((c): c is string => typeof c === "string")
  ) {
    return { error: "Malformed deck" };
  }
  if (typeof d.heroId !== "string" || !hasHero(d.heroId)) {
    return { error: "Unknown hero" };
  }
  const err = validateDeck(d.cards, getHero(d.heroId).cardClass);
  if (err) return { error: `Illegal deck: ${err}` };
  return { cards: [...d.cards], heroId: d.heroId };
}

class Match {
  private state: GameState;
  private sockets: [WebSocket, WebSocket];
  private readonly tokens: [string, string];
  private readonly connected: [boolean, boolean] = [true, true];
  private readonly graceTimers: [NodeJS.Timeout | null, NodeJS.Timeout | null] = [
    null,
    null,
  ];

  constructor(
    sockets: [WebSocket, WebSocket],
    private readonly names: [string, string],
    decks: [DeckChoice, DeckChoice],
  ) {
    this.sockets = sockets;
    this.tokens = [
      randomBytes(18).toString("hex"),
      randomBytes(18).toString("hex"),
    ];
    this.state = createGame({
      decks: [[...decks[0].cards], [...decks[1].cards]],
      heroes: [decks[0].heroId, decks[1].heroId],
    });
    for (const seat of [0, 1] as const) {
      rejoinable.set(this.tokens[seat], { match: this, seat });
      send(this.sockets[seat], {
        type: "start",
        seat,
        names: this.names,
        state: redactState(this.state, seat),
        rejoinToken: this.tokens[seat],
      });
    }
    console.log(`[match] ${this.names[0]} vs ${this.names[1]}`);
  }

  canRejoin(seat: PlayerIndex): boolean {
    return this.state.phase !== "gameover" && !this.connected[seat];
  }

  /** Reattach a fresh socket to a disconnected seat. */
  attach(seat: PlayerIndex, ws: WebSocket): void {
    this.sockets[seat] = ws;
    this.connected[seat] = true;
    const timer = this.graceTimers[seat];
    if (timer) {
      clearTimeout(timer);
      this.graceTimers[seat] = null;
    }
    this.state.log.push(`${this.names[seat]} reconnected`);
    send(ws, {
      type: "start",
      seat,
      names: this.names,
      state: redactState(this.state, seat),
      rejoinToken: this.tokens[seat],
    });
    const opp = other(seat);
    send(this.sockets[opp], {
      type: "update",
      state: redactState(this.state, opp),
    });
    console.log(`[match] ${this.names[seat]} reconnected`);
  }

  onAction(seat: PlayerIndex, raw: unknown): void {
    const action = raw as Action | undefined;
    if (!action || typeof action !== "object" || action.player !== seat) {
      return send(this.sockets[seat], { type: "error", message: "Malformed action" });
    }
    const err = validateAction(this.state, action);
    if (err) return send(this.sockets[seat], { type: "error", message: err });
    try {
      this.state = applyAction(this.state, action);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Action rejected";
      return send(this.sockets[seat], { type: "error", message });
    }
    this.broadcast(action);
    if (this.state.phase === "gameover") {
      console.log(`[match] finished: winner ${String(this.state.winner)}`);
      this.cleanup();
    }
  }

  /** A socket dropped: hold the seat open for RECONNECT_GRACE_MS. */
  onDisconnect(seat: PlayerIndex): void {
    this.connected[seat] = false;
    if (this.state.phase === "gameover") return;
    this.state.log.push(
      `${this.names[seat]} disconnected — waiting up to ` +
        `${Math.round(RECONNECT_GRACE_MS / 1000)}s for them to reconnect`,
    );
    this.broadcast();
    this.graceTimers[seat] = setTimeout(
      () => this.forfeit(seat),
      RECONNECT_GRACE_MS,
    );
    console.log(`[match] ${this.names[seat]} disconnected, grace period started`);
  }

  private forfeit(seat: PlayerIndex): void {
    if (this.state.phase === "gameover") return;
    this.state.phase = "gameover";
    this.state.winner = other(seat);
    this.state.log.push(
      `${this.names[seat]} failed to reconnect — ${this.names[other(seat)]} wins`,
    );
    this.broadcast();
    this.cleanup();
    console.log(`[match] ${this.names[seat]} forfeits (reconnect grace expired)`);
  }

  /** Match over: rejoin tokens and timers are no longer needed. */
  private cleanup(): void {
    for (const seat of [0, 1] as const) {
      rejoinable.delete(this.tokens[seat]);
      const timer = this.graceTimers[seat];
      if (timer) {
        clearTimeout(timer);
        this.graceTimers[seat] = null;
      }
    }
  }

  private broadcast(action?: Action): void {
    for (const seat of [0, 1] as const) {
      send(this.sockets[seat], {
        type: "update",
        state: redactState(this.state, seat),
        action,
      });
    }
  }
}

const httpServer = createServer((req, res) => {
  void handleApi(req, res);
});

const wss = new WebSocketServer({ server: httpServer });

let waiting: { ws: WebSocket; name: string; deck: DeckChoice } | null = null;
const seated = new Map<WebSocket, { match: Match; seat: PlayerIndex }>();
/** Rejoin token -> the seat it can reclaim. Entries removed when a match ends. */
const rejoinable = new Map<string, { match: Match; seat: PlayerIndex }>();

wss.on("connection", (ws) => {
  ws.on("message", (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return send(ws, { type: "error", message: "Invalid message" });
    }

    const mine = seated.get(ws);
    if (mine) {
      if (msg.type === "action") mine.match.onAction(mine.seat, msg.action);
      return;
    }

    if (msg.type !== "join") {
      return send(ws, { type: "error", message: "Join a game first" });
    }
    if (waiting?.ws === ws) return; // double-join from the queued player

    // Rejoining an in-progress match takes priority over matchmaking.
    if (typeof msg.rejoin === "string") {
      const entry = rejoinable.get(msg.rejoin);
      if (!entry || !entry.match.canRejoin(entry.seat)) {
        return send(ws, {
          type: "error",
          message: "Match no longer available to rejoin",
        });
      }
      entry.match.attach(entry.seat, ws);
      seated.set(ws, { match: entry.match, seat: entry.seat });
      return;
    }

    // Logged-in players play under their account name.
    const accountName = authenticate(msg.token);
    const name =
      accountName ??
      (typeof msg.name === "string" && msg.name.trim()
        ? msg.name.trim().slice(0, 20)
        : "");

    const deck = parseDeck(msg.deck);
    if ("error" in deck) {
      return send(ws, { type: "error", message: deck.error });
    }

    if (!waiting) {
      waiting = { ws, name: name || "Player 1", deck };
      send(ws, { type: "waiting" });
      return;
    }

    const first = waiting;
    waiting = null;
    const match = new Match(
      [first.ws, ws],
      [first.name, name || "Player 2"],
      [first.deck, deck],
    );
    seated.set(first.ws, { match, seat: 0 });
    seated.set(ws, { match, seat: 1 });
  });

  ws.on("close", () => {
    if (waiting?.ws === ws) waiting = null;
    const mine = seated.get(ws);
    if (mine) {
      seated.delete(ws);
      mine.match.onDisconnect(mine.seat);
    }
  });

  ws.on("error", () => {
    // close handler does the cleanup
  });
});

httpServer.listen(PORT, () => {
  console.log(`ArcaneClash server (HTTP API + matches) listening on port ${PORT}`);
});
