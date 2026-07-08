// End-to-end smoke test: account API (register/login/deck storage), then two
// WebSocket clients join, verify redaction and class loadouts, trade turns,
// confirm off-turn actions are rejected, and check disconnect-forfeit.
// Run with the server already listening.

import WebSocket from "ws";
import { starterDeckFor } from "../../engine/src/index";

const HOST = process.env.HOST ?? "127.0.0.1:8787";
const WS_URL = `ws://${HOST}`;
const API = `http://${HOST}`;

const timeout = setTimeout(() => {
  console.error("SMOKE FAIL: timed out");
  process.exit(1);
}, 20000);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Msg = any;

class TestClient {
  ws: WebSocket;
  private queue: Msg[] = [];
  private waiters: ((m: Msg) => void)[] = [];

  constructor() {
    this.ws = new WebSocket(WS_URL);
    this.ws.on("message", (d) => {
      const msg = JSON.parse(String(d));
      const w = this.waiters.shift();
      if (w) w(msg);
      else this.queue.push(msg);
    });
  }

  open(): Promise<void> {
    return new Promise((res, rej) => {
      this.ws.on("open", res);
      this.ws.on("error", rej);
    });
  }

  next(): Promise<Msg> {
    const m = this.queue.shift();
    if (m !== undefined) return Promise.resolve(m);
    return new Promise((res) => this.waiters.push(res));
  }

  send(m: Msg): void {
    this.ws.send(JSON.stringify(m));
  }
}

function assert(cond: boolean, label: string): void {
  if (!cond) {
    console.error(`SMOKE FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`ok - ${label}`);
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: Msg }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// Account API
// ---------------------------------------------------------------------------

const username = `smoke_${Date.now() % 100000}`;
const password = "hunter2";

const reg = await api("POST", "/api/register", { username, password });
assert(reg.status === 200 && typeof reg.body.token === "string", "register issues a token");

const dupe = await api("POST", "/api/register", { username, password });
assert(dupe.status === 400, "duplicate username rejected");

const badLogin = await api("POST", "/api/login", { username, password: "wrong" });
assert(badLogin.status === 400, "wrong password rejected");

const goodLogin = await api("POST", "/api/login", { username, password });
assert(goodLogin.status === 200, "login works");
const token: string = goodLogin.body.token;

const noAuth = await api("GET", "/api/decks");
assert(noAuth.status === 401, "deck storage requires auth");

const myDeck = {
  id: "d1",
  name: "Smoke Morgana",
  heroId: "morgana",
  cards: starterDeckFor("morgana"),
};
const putBad = await api(
  "PUT",
  "/api/decks",
  { decks: [{ ...myDeck, cards: ["ember_bolt"] }] },
  token,
);
assert(putBad.status === 400, "illegal saved deck rejected");

const putGood = await api("PUT", "/api/decks", { decks: [myDeck] }, token);
assert(putGood.status === 200, "legal deck saved to account");

const got = await api("GET", "/api/decks", undefined, token);
assert(
  got.status === 200 &&
    got.body.decks.length === 1 &&
    got.body.decks[0].heroId === "morgana",
  "saved decks round-trip",
);

// ---------------------------------------------------------------------------
// Matchmaking + gameplay
// ---------------------------------------------------------------------------

// An illegal deck must be rejected at the door, without queuing the player.
const cheater = new TestClient();
await cheater.open();
cheater.send({
  type: "join",
  name: "Cheater",
  deck: { cards: ["ember_bolt"], heroId: "merlin" },
});
const cheaterResp = await cheater.next();
assert(
  cheaterResp.type === "error" && /deck/i.test(cheaterResp.message),
  "illegal deck rejected at join",
);
cheater.ws.close();

// Alice joins with her account token and her saved Morgana deck.
const a = new TestClient();
await a.open();
a.send({
  type: "join",
  name: "IgnoredBecauseToken",
  token,
  deck: { cards: myDeck.cards, heroId: "morgana" },
});
const waitingMsg = await a.next();
assert(waitingMsg.type === "waiting", "first client queues as waiting");

const b = new TestClient();
await b.open();
b.send({ type: "join", name: "Bob" });

const startA = await a.next();
const startB = await b.next();
assert(startA.type === "start" && startB.type === "start", "both clients receive start");
assert(startA.seat !== startB.seat, "clients get distinct seats");
assert(
  startA.names[startA.seat] === username,
  "logged-in player plays under their account name",
);
assert(startA.names[startB.seat] === "Bob", "guest keeps their typed name");

const oppSeat = startA.seat === 0 ? 1 : 0;
assert(
  startA.state.players[oppSeat].hand.every((c: Msg) => c.defId === "hidden"),
  "opponent hand is redacted",
);
assert(
  startA.state.players[startA.seat].hand.every((c: Msg) => c.defId !== "hidden"),
  "own hand is visible",
);
assert(
  startA.state.players[startA.seat].deck.every((c: Msg) => c.defId === "hidden"),
  "own deck order is hidden",
);
assert(startA.state.rng === 0, "rng state is not leaked");
assert(
  startA.state.players[startA.seat].heroId === "morgana" &&
    startA.state.players[startA.seat].heroPowerId === "hp_bargain",
  "submitted hero and class hero power are used",
);
assert(
  startA.state.players[startB.seat].heroId === "merlin",
  "deck-less join falls back to the Merlin starter",
);

const firstActive = startA.state.active;
const activeClient = firstActive === startA.seat ? a : b;
const idleClient = firstActive === startA.seat ? b : a;
const idleSeat = firstActive === startA.seat ? startB.seat : startA.seat;

// Off-turn action must be rejected without touching state.
idleClient.send({ type: "action", action: { type: "END_TURN", player: idleSeat } });
const rejection = await idleClient.next();
assert(
  rejection.type === "error" && /turn/i.test(rejection.message),
  "off-turn action rejected",
);

// Active player ends turn; both clients see turn 2.
activeClient.send({ type: "action", action: { type: "END_TURN", player: firstActive } });
const updA = await a.next();
const updB = await b.next();
assert(updA.type === "update" && updB.type === "update", "both clients receive update");
assert(updA.state.turn === 2 && updB.state.turn === 2, "turn advanced to 2");
assert(updA.state.active !== firstActive, "active player switched");

// Spoofed seat must be rejected.
activeClient.send({
  type: "action",
  action: { type: "END_TURN", player: updA.state.active },
});
const spoof = await activeClient.next();
assert(spoof.type === "error", "seat-spoofed action rejected");

// Disconnect forfeits to the remaining player.
b.ws.close();
const finalMsg = await a.next();
assert(
  finalMsg.type === "update" &&
    finalMsg.state.phase === "gameover" &&
    finalMsg.state.winner === startA.seat,
  "disconnect forfeits the match to the remaining player",
);

console.log("SMOKE PASS");
clearTimeout(timeout);
a.ws.close();
process.exit(0);
