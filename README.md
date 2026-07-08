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
npm run smoke      # end-to-end multiplayer test (self-hosts a server on :8788)
npm run typecheck  # strict TS across all packages
npm run build      # production build of the client
```

## Playing

- **Play vs AI** — you're the bottom seat; a greedy one-ply AI runs the top.
- **Hotseat** — two players share the screen; the view flips each turn.
- **Play Online** — needs `npm run server` running. First player queues,
  second player to click gets matched against them.
- **Reconnect** — a page refresh or dropped connection mid-match no longer
  forfeits. The server issues each player a secret rejoin token (stored in
  sessionStorage) and holds the seat for a grace period
  (`RECONNECT_GRACE_MS`, default 60s). The client auto-retries dropped
  sockets and auto-rejoins after a refresh; the opponent sees
  disconnect/reconnect notices in the battle log. Leaving via the Menu
  button abandons the seat on purpose; only when the grace expires does the
  match forfeit to the remaining player.
- **Heroes & classes** — six heroes from public-domain legend, each with a
  class, a hero power, three class cards, and a ready-made starter deck:
  Merlin (Mage, Flame Jab + Freeze effects), Morgana (Warlock, Blood Bargain
  self-damage/draw), Parcifal (Paladin, Rally Squire tokens), Lancelot
  (Warrior, Raise Bulwark armor), Martin (Priest, Gentle Mend healing),
  Robin Hood (Hunter, Piercing Shot face damage).
- **Deck Builder** — pick a hero, then build from neutral cards + that
  hero's class cards (30 cards, max 2 copies, 1 per legendary). The menu
  dropdown picks which deck you play. The server re-validates every
  submitted deck (size, copies, class legality), so illegal decks can't
  enter a match.
- **Accounts** — register/log in from the main menu (served by the match
  server, salted scrypt password hashes, stored in
  `packages/server/data/users.json`). Logged-in players' decks are saved to
  their account and follow them to any device on the LAN, and they play
  online under their account name. Guests still get localStorage decks and
  a typed guest name.
- **Mulligan** — every match opens with a mulligan: click the cards you want
  to throw back, confirm, and draw replacements (which can't be the cards you
  threw back). Both players choose secretly; the Coin and turn one arrive
  once both have confirmed. In hotseat the two players mulligan in sequence
  at the bottom seat; the AI tosses cards costing 4+.
- Click a card to play it. Cards that need a target enter arrow-targeting
  mode; click the target to commit, right-click to cancel.
- Click one of your minions, then an enemy, to attack.
- The circle next to your hero is your hero power.
- **Sound** — effects live in `packages/client/public/sfx` and are wired via
  `src/game/sfx.ts`. Combat sounds are driven by state diffs (deaths, shield
  breaks, freezes, heals, hero damage) so they fire no matter what caused the
  event; a 🔊/🔇 toggle in the menu and in-game side panel persists to
  localStorage.

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
4. ~~User accounts + classes/heroes (with Freeze)~~ (done)
5. ~~Mulligan phase~~ (done)
6. ~~Reconnect-to-match support~~ (done)
7. More keywords (spell damage, auras, weapons)
8. Card art, richer particle effects (sound: done)
