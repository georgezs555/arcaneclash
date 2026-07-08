// End-to-end smoke test: account API (register/login/deck storage), then two
// WebSocket clients join, verify redaction and class loadouts, mulligan,
// trade turns, confirm off-turn actions are rejected, and exercise the
// reconnect flow (grace period, rejoin, token rejection, forfeit on expiry).
//
// The test hosts its own server instance on a separate port with a short
// reconnect grace so the forfeit path completes quickly.

import WebSocket from "ws";
import { starterDeckFor } from "../../engine/src/index";

const PORT = 8788;
const GRACE_MS = 1200;
process.env.PORT = String(PORT);
process.env.RECONNECT_GRACE_MS = String(GRACE_MS);

const HOST = `127.0.0.1:${PORT}`;
const WS_URL = `ws://${HOST}`;
const API = `http://${HOST}`;

const timeout = setTimeout(() => {
  console.error("SMOKE FAIL: timed out");
  process.exit(1);
}, 30000);

// Boot the server in-process, then wait until it accepts HTTP requests.
await import("../src/index");
for (let i = 0; ; i++) {
  try {
    await fetch(`${API}/api/decks`);
    break;
  } catch {
    if (i >= 50) {
      console.error("SMOKE FAIL: server did not start");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

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
  typeof startA.rejoinToken === "string" && startA.rejoinToken !== startB.rejoinToken,
  "each player receives a distinct rejoin token",
);
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

// --- mulligan phase ---

assert(startA.state.phase === "mulligan", "match starts in the mulligan phase");

// Turn actions are rejected until both players have mulliganed.
a.send({ type: "action", action: { type: "END_TURN", player: startA.seat } });
const tooEarly = await a.next();
assert(
  tooEarly.type === "error" && /started/i.test(tooEarly.message),
  "turn actions rejected during mulligan",
);

// Alice throws back her whole hand.
const beforeIds = startA.state.players[startA.seat].hand.map(
  (c: Msg) => c.instanceId,
);
a.send({
  type: "action",
  action: { type: "MULLIGAN", player: startA.seat, replace: beforeIds },
});
const mullA = await a.next();
await b.next(); // opponent's copy of the same update
assert(
  mullA.type === "update" && mullA.state.phase === "mulligan",
  "game waits for the second mulligan",
);
const rehand = mullA.state.players[startA.seat].hand;
assert(rehand.length === beforeIds.length, "mulligan returns the same hand size");
assert(
  rehand.every((c: Msg) => !beforeIds.includes(c.instanceId)),
  "replaced cards are different copies",
);

// Bob keeps everything; the game starts.
b.send({
  type: "action",
  action: { type: "MULLIGAN", player: startB.seat, replace: [] },
});
const playA = await a.next();
const playB = await b.next();
assert(
  playA.state.phase === "playing" && playB.state.phase === "playing",
  "both mulligans start the game",
);
const secondSeat = playA.state.active === 0 ? 1 : 0;
assert(
  playA.state.players[secondSeat].hand.length === 5 &&
    playA.state.players[playA.state.active].hand.length === 4,
  "coin and turn-one draw arrive after the mulligan",
);

// --- turn play ---

const firstActive = playA.state.active;
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

// --- reconnect ---

// Bob drops mid-match: no immediate forfeit, opponent is notified instead.
b.ws.close();
const notice = await a.next();
assert(
  notice.type === "update" && notice.state.phase === "playing",
  "disconnect does not immediately forfeit",
);
assert(
  notice.state.log.some((l: string) => /disconnected/.test(l)),
  "opponent is told about the disconnect",
);

// Bob rejoins with his token and gets his seat and the live state back.
const b2 = new TestClient();
await b2.open();
b2.send({ type: "join", rejoin: startB.rejoinToken });
const resume = await b2.next();
assert(
  resume.type === "start" && resume.seat === startB.seat,
  "rejoin restores the same seat",
);
assert(
  resume.state.phase === "playing" && resume.state.turn === 2,
  "rejoin restores the live game state",
);
assert(
  resume.state.players[startA.seat].hand.every((c: Msg) => c.defId === "hidden"),
  "rejoin state is still redacted",
);
const rejoinNote = await a.next();
assert(
  rejoinNote.type === "update" &&
    rejoinNote.state.log.some((l: string) => /reconnected/.test(l)),
  "opponent sees the reconnect",
);

// Bogus tokens and occupied seats are rejected.
const c = new TestClient();
await c.open();
c.send({ type: "join", rejoin: "bogus-token" });
const badToken = await c.next();
assert(badToken.type === "error", "unknown rejoin token rejected");
c.send({ type: "join", rejoin: startB.rejoinToken });
const stolenSeat = await c.next();
assert(stolenSeat.type === "error", "cannot rejoin a seat that is still connected");
c.ws.close();

// If the grace period expires, the match forfeits to the remaining player.
b2.ws.close();
const notice2 = await a.next();
assert(
  notice2.type === "update" && notice2.state.phase === "playing",
  "second disconnect gets a grace period too",
);
const finalMsg = await a.next(); // fires after ~GRACE_MS
assert(
  finalMsg.type === "update" &&
    finalMsg.state.phase === "gameover" &&
    finalMsg.state.winner === startA.seat,
  "grace expiry forfeits the match to the remaining player",
);

// The finished match's tokens are dead.
const d = new TestClient();
await d.open();
d.send({ type: "join", rejoin: startB.rejoinToken });
const deadToken = await d.next();
assert(deadToken.type === "error", "tokens die when the match ends");
d.ws.close();

console.log("SMOKE PASS");
clearTimeout(timeout);
a.ws.close();
process.exit(0);
