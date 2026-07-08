# ArcaneClash

A browser-based card battler in the style of classic collectible card games:
30-card decks, mana crystals that grow 1→10, minions with Taunt / Charge /
Rush / Windfury / Divine Shield, battlecries, deathrattles, hero powers, and
30-health heroes. All card names, text, and content are original.

## Repo layout (npm workspaces)

| Package | What it is |
| --- | --- |
| `packages/engine` | Pure, deterministic rules engine + card registry + greedy AI. No DOM, no rendering. Shared by client and server. |
| `packages/client` | React app shell + PixiJS board renderer with tweened 2D animations. |
| `packages/server` | Authoritative Node WebSocket match server: queue matchmaking, server-side validation of every action, hidden-information redaction, disconnect = forfeit. |

## Commands (run from repo root)

```
npm install        # once
npm run dev        # start the game at http://localhost:5173
npm run server     # start the multiplayer match server on port 8787
npm test           # engine test suite (vitest)
npm run smoke      # end-to-end multiplayer test (needs the server running)
npm run typecheck  # strict TS across all packages
npm run build      # production build of the client
```

## Playing

- **Play vs AI** — you're the bottom seat; a greedy one-ply AI runs the top.
- **Hotseat** — two players share the screen; the view flips each turn.
- **Play Online** — needs `npm run server` running. First player queues,
  second player to click gets matched against them. Closing the tab forfeits.
- **Deck Builder** — build decks from the collection (30 cards, max 2 copies,
  1 per legendary) and pick the deck's hero power. Decks persist in
  localStorage; the menu dropdown picks which deck you play. The server
  re-validates every submitted deck, so illegal decks can't enter a match.
- Click a card to play it. Cards that need a target enter arrow-targeting
  mode; click the target to commit, right-click to cancel.
- Click one of your minions, then an enemy, to attack.
- The circle next to your hero is your hero power.

## Hosting for your LAN

Run both `npm run dev` and `npm run server` on the host machine. Other
devices browse to `http://<host-LAN-IP>:5173`; the page connects its
WebSocket to the same hostname on port 8787 automatically. Both TCP ports
(5173 and 8787) must be allowed through the host's firewall.

## Architecture notes

- `GameState` is plain serializable data; card behavior lives in the
  registry keyed by `defId`. `applyAction(state, action) → state` is pure and
  validated, and RNG is seeded inside the state — the exact property needed
  for an authoritative multiplayer server and replays.
- The client's `GameController` is the seam where networking slots in: it is
  the only thing that owns state transitions. Milestone 2 replaces its
  internals with a WebSocket protocol against `packages/server`.
- The Pixi `Board` renders whatever state it's given and animates the diff
  (draws, plays, lunges, damage floats, deaths), keyed by card `instanceId`.

## Roadmap

1. ~~Rules engine + playable hotseat/AI client~~ (done)
2. ~~WebSocket server + quick-match queue: real 2-player online matches~~ (done)
3. ~~Deck builder + collection screens~~ (done)
4. Mulligan phase, more keywords (freeze, spell damage, auras, weapons),
   reconnect-to-match support
5. Card art, sound, richer particle effects
