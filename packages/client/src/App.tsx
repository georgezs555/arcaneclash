import { useEffect, useRef, useState } from "react";
import type { GameState } from "@arcaneclash/engine";
import {
  GameController,
  type Controller,
  type Mode,
} from "./game/controller";
import { NetController, type NetStatus } from "./game/net";
import { Board } from "./game/board";
import { DecksScreen, DeckEditor } from "./DeckBuilder";
import {
  builtinDecks,
  fetchCustomDecks,
  getSelectedDeckId,
  persistCustomDecks,
  resolveDeck,
  setSelectedDeckId,
  type DeckData,
} from "./game/decks";
import { getSession, login, register, storeSession, type Session } from "./game/auth";

type Screen =
  | { kind: "menu" }
  | { kind: "decks" }
  | { kind: "editor"; deckId: string | null }
  | { kind: "local"; mode: Mode; gameId: number }
  | { kind: "online"; gameId: number };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: "menu" });
  const [session, setSession] = useState<Session | null>(getSession());
  const [customDecks, setCustomDecks] = useState<DeckData[]>([]);
  const [deckId, setDeckId] = useState(getSelectedDeckId());
  const [guestName, setGuestName] = useState("");
  const [syncError, setSyncError] = useState<string | null>(null);

  // (Re)load custom decks whenever the session changes.
  useEffect(() => {
    let cancelled = false;
    setSyncError(null);
    fetchCustomDecks(session)
      .then((decks) => {
        if (!cancelled) setCustomDecks(decks);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setCustomDecks([]);
        if (session) {
          setSyncError(e.message);
          if (/log in again/.test(e.message)) {
            storeSession(null);
            setSession(null);
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const toMenu = () => setScreen({ kind: "menu" });
  const deck = resolveDeck(deckId, customDecks);

  const updateDecks = (next: DeckData[]) => {
    setCustomDecks(next);
    persistCustomDecks(session, next).catch((e: Error) => setSyncError(e.message));
  };

  if (screen.kind === "menu") {
    return (
      <div className="menu">
        <h1>ArcaneClash</h1>
        <p className="tagline">A card battler of wits, minions, and mana.</p>
        <button onClick={() => setScreen({ kind: "local", mode: "ai", gameId: 1 })}>
          Play vs AI
        </button>
        <button
          onClick={() => setScreen({ kind: "local", mode: "hotseat", gameId: 1 })}
        >
          Hotseat (2 players)
        </button>
        <div className="deck-row">
          <select
            value={deck.id}
            onChange={(e) => {
              setDeckId(e.target.value);
              setSelectedDeckId(e.target.value);
            }}
          >
            {[...builtinDecks(), ...customDecks].map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button onClick={() => setScreen({ kind: "decks" })}>Deck Builder</button>
        </div>
        <div className="online-row">
          {!session && (
            <input
              placeholder="Guest name"
              maxLength={20}
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
            />
          )}
          <button onClick={() => setScreen({ kind: "online", gameId: 1 })}>
            Play Online{session ? ` as ${session.username}` : ""}
          </button>
        </div>
        <AccountPanel
          session={session}
          onSession={(s) => {
            setSession(s);
            storeSession(s);
          }}
        />
        {syncError && <p className="sync-error">{syncError}</p>}
      </div>
    );
  }

  if (screen.kind === "decks") {
    return (
      <DecksScreen
        decks={customDecks}
        onBack={toMenu}
        onNew={() => setScreen({ kind: "editor", deckId: null })}
        onEdit={(id) => setScreen({ kind: "editor", deckId: id })}
        onDelete={(id) => updateDecks(customDecks.filter((d) => d.id !== id))}
      />
    );
  }

  if (screen.kind === "editor") {
    return (
      <DeckEditor
        initial={customDecks.find((d) => d.id === screen.deckId) ?? null}
        onCancel={() => setScreen({ kind: "decks" })}
        onSave={(saved) => {
          updateDecks([...customDecks.filter((d) => d.id !== saved.id), saved]);
          setScreen({ kind: "decks" });
        }}
      />
    );
  }

  if (screen.kind === "local") {
    return (
      <LocalGame
        key={screen.gameId}
        mode={screen.mode}
        deck={deck}
        onMenu={toMenu}
        onRestart={() =>
          setScreen({ kind: "local", mode: screen.mode, gameId: screen.gameId + 1 })
        }
      />
    );
  }

  return (
    <OnlineGame
      key={screen.gameId}
      name={session?.username ?? guestName}
      token={session?.token}
      deck={deck}
      onMenu={toMenu}
      onRestart={() => setScreen({ kind: "online", gameId: screen.gameId + 1 })}
    />
  );
}

// ---------------------------------------------------------------------------
// Account panel (menu)
// ---------------------------------------------------------------------------

function AccountPanel({
  session,
  onSession,
}: {
  session: Session | null;
  onSession: (s: Session | null) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) {
    return (
      <div className="account-panel">
        <span>
          Signed in as <strong>{session.username}</strong> — decks are saved to
          your account.
        </span>
        <button className="small" onClick={() => onSession(null)}>
          Log out
        </button>
      </div>
    );
  }

  const submit = async (kind: "login" | "register") => {
    setBusy(true);
    setError(null);
    try {
      const s = await (kind === "login"
        ? login(username, password)
        : register(username, password));
      onSession(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-panel">
      <input
        placeholder="Username"
        maxLength={20}
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="account-buttons">
        <button className="small" disabled={busy} onClick={() => submit("login")}>
          Log in
        </button>
        <button className="small" disabled={busy} onClick={() => submit("register")}>
          Register
        </button>
      </div>
      {error && <span className="sync-error">{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Game wrappers
// ---------------------------------------------------------------------------

function LocalGame({
  mode,
  deck,
  onMenu,
  onRestart,
}: {
  mode: Mode;
  deck: DeckData;
  onMenu: () => void;
  onRestart: () => void;
}) {
  const [ctrl] = useState(() => new GameController(mode, deck));
  return <GameView ctrl={ctrl} onMenu={onMenu} onRestart={onRestart} />;
}

function OnlineGame({
  name,
  token,
  deck,
  onMenu,
  onRestart,
}: {
  name: string;
  token?: string;
  deck: DeckData;
  onMenu: () => void;
  onRestart: () => void;
}) {
  const [ctrl] = useState(
    () => new NetController(`ws://${location.hostname}:8787`, name, deck, token),
  );
  const [status, setStatus] = useState<NetStatus>(ctrl.status);

  useEffect(() => {
    const unsub = ctrl.onStatus(setStatus);
    ctrl.start();
    return () => {
      unsub();
      ctrl.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "playing" || status === "closed") {
    return <GameView ctrl={ctrl} onMenu={onMenu} onRestart={onRestart} />;
  }

  return (
    <div className="menu">
      <h1>ArcaneClash</h1>
      <p className="tagline">
        {status === "connecting" && "Connecting to the game server…"}
        {status === "waiting" && "Waiting for an opponent to join…"}
        {status === "failed" &&
          "Could not reach the game server. Is it running? (npm run server)"}
      </p>
      <button onClick={onMenu}>Cancel</button>
    </div>
  );
}

function GameView({
  ctrl,
  onMenu,
  onRestart,
}: {
  ctrl: Controller;
  onMenu: () => void;
  onRestart: () => void;
}) {
  const [state, setState] = useState<GameState>(ctrl.state);
  const [error, setError] = useState<string | null>(null);
  const boardHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const board = new Board(
      boardHost.current!,
      (a) => ctrl.trySubmit(a),
      ctrl.seatNames(),
    );
    board.update(ctrl.state, undefined, ctrl.bottomSeat());

    let errTimer: ReturnType<typeof setTimeout> | null = null;
    const unsub = ctrl.subscribe((ev) => {
      setState(ev.state);
      if (ev.error) {
        setError(ev.error);
        if (errTimer) clearTimeout(errTimer);
        errTimer = setTimeout(() => setError(null), 2200);
      } else {
        board.update(ev.state, ev.action, ctrl.bottomSeat());
      }
    });
    ctrl.start();

    return () => {
      unsub();
      if (errTimer) clearTimeout(errTimer);
      ctrl.destroy();
      board.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bottom = ctrl.bottomSeat();
  const me = state.players[bottom];
  const myTurn = ctrl.isHumanTurn();
  const over = state.phase === "gameover";

  let verdict = "";
  if (over) {
    if (state.winner === "draw") verdict = "It's a draw!";
    else if (ctrl.modeLabel === "hotseat")
      verdict = `Player ${(state.winner as number) + 1} wins!`;
    else verdict = state.winner === bottom ? "Victory!" : "Defeat...";
  }

  return (
    <div className="game-root">
      <div className="board-wrap">
        <div ref={boardHost} />
        <div className="hud">
          <div className="hud-line">
            Turn {state.turn}
            {ctrl.modeLabel === "hotseat" && ` — Player ${bottom + 1}`}
            {ctrl.modeLabel === "online" && ` — ${ctrl.seatNames()[bottom]}`}
          </div>
          <div className="hud-line mana">
            {"◆".repeat(me.mana)}
            <span className="mana-count">
              {me.mana}/{me.maxMana}
            </span>
          </div>
          <div className="hud-line">Deck: {me.deck.length}</div>
          <button
            className="end-turn"
            disabled={!myTurn}
            onClick={() => ctrl.trySubmit({ type: "END_TURN", player: bottom })}
          >
            {myTurn ? "End Turn" : "Enemy turn…"}
          </button>
        </div>
        {error && <div className="toast">{error}</div>}
        {over && (
          <div className="overlay">
            <h2>{verdict}</h2>
            <button onClick={onRestart}>
              {ctrl.modeLabel === "online" ? "Find another match" : "Play again"}
            </button>
            <button onClick={onMenu}>Main menu</button>
          </div>
        )}
      </div>
      <aside className="side">
        <button className="menu-btn" onClick={onMenu}>
          ← Menu
        </button>
        <h3>Battle log</h3>
        <ul className="log">
          {state.log.slice(-16).map((line, i) => (
            <li key={`${state.log.length}-${i}`}>{line}</li>
          ))}
        </ul>
        <p className="hint">
          Click a card to play it. Cards with a red arrow need a target. Click
          a minion, then a target, to attack. Right-click cancels.
        </p>
      </aside>
    </div>
  );
}
