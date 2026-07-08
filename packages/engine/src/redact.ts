// Hidden-information filtering for multiplayer. The server holds the full
// authoritative state and sends each player a view with the opponent's hand,
// both deck contents, and the RNG state blanked out.

import { other } from "./mechanics";
import type { GameState, PlayerIndex } from "./types";

export function redactState(state: GameState, viewer: PlayerIndex): GameState {
  const s = structuredClone(state);
  s.rng = 0;
  for (const c of s.players[other(viewer)].hand) c.defId = "hidden";
  for (const p of [0, 1] as const) {
    for (const c of s.players[p].deck) c.defId = "hidden";
  }
  return s;
}
