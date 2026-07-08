// A simple greedy AI: score each legal action by simulating it one step ahead,
// pick the best, repeat until only END_TURN remains attractive.
// Good enough to test the game against; easy to swap for something smarter later.

import { applyAction, legalActions } from "./game";
import { other } from "./mechanics";
import { getCardDef } from "./registry";
import type { Action, GameState, PlayerIndex } from "./types";

function evaluate(state: GameState, p: PlayerIndex): number {
  if (state.phase === "gameover") {
    if (state.winner === p) return 1e9;
    if (state.winner === other(p)) return -1e9;
    return 0;
  }
  const me = state.players[p];
  const foe = state.players[other(p)];
  let score = 0;
  score += (me.hero.health + me.hero.armor) * 2;
  score -= (foe.hero.health + foe.hero.armor) * 3;
  for (const m of me.board) score += m.attack * 2 + m.health + (m.divineShield ? 2 : 0);
  for (const m of foe.board) score -= m.attack * 2.5 + m.health + (m.divineShield ? 2 : 0);
  score += me.hand.length;
  score -= foe.hand.length;
  return score;
}

/** Pick the AI's next single action (call repeatedly until it returns END_TURN). */
export function chooseAction(state: GameState, p: PlayerIndex): Action {
  // Mulligan strategy: throw back expensive cards, fish for an early curve.
  if (state.phase === "mulligan") {
    const replace = state.players[p].hand
      .filter((c) => getCardDef(c.defId).cost >= 4)
      .map((c) => c.instanceId);
    return { type: "MULLIGAN", player: p, replace };
  }

  const actions = legalActions(state, p);
  const endTurn = actions.find((a) => a.type === "END_TURN")!;
  let best: { action: Action; score: number } = {
    action: endTurn,
    score: evaluate(state, p),
  };
  for (const action of actions) {
    if (action.type === "END_TURN") continue;
    let score: number;
    try {
      score = evaluate(applyAction(state, action), p);
    } catch {
      continue;
    }
    // Small bias so the AI prefers acting over passing on equal scores.
    if (score + 0.5 > best.score) best = { action, score };
  }
  return best.action;
}
