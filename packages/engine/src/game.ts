// The game state machine: game creation, legality checks, and action application.
// applyAction is pure: it clones the state, applies the move, and returns the clone.
// That property is what lets the server and client share this engine verbatim.

import { getCardDef, getHero, getHeroPower } from "./registry";
import {
  MAX_BOARD,
  MAX_MANA,
  START_HEALTH,
  createInstance,
  dealDamage,
  drawCard,
  hasKeyword,
  makeRng,
  other,
  resolve,
  resolveDeaths,
  shuffle,
} from "./mechanics";
import type {
  Action,
  CardInstance,
  CharRef,
  GameState,
  PlayerIndex,
  PlayerState,
  TargetSpec,
} from "./types";

export interface GameSetup {
  decks: [string[], string[]]; // card def ids, 30 each
  /** Hero ids (see registerHero); the hero determines the hero power. */
  heroes: [string, string];
  seed?: number;
  /** Which player goes first; randomized from seed if omitted. */
  first?: PlayerIndex;
}

export function createGame(setup: GameSetup): GameState {
  const state: GameState = {
    players: [emptyPlayer(setup.heroes[0]), emptyPlayer(setup.heroes[1])],
    active: 0,
    turn: 0,
    phase: "playing",
    winner: null,
    rng: (setup.seed ?? Date.now()) >>> 0 || 1,
    nextInstanceId: 1,
    log: [],
  };
  const rng = makeRng(state);
  state.active = setup.first ?? ((rng() < 0.5 ? 0 : 1) as PlayerIndex);

  for (const p of [0, 1] as const) {
    const pl = state.players[p];
    pl.deck = setup.decks[p].map((defId) => {
      const inst = createInstance(state, defId, p);
      inst.summonedThisTurn = false;
      return inst;
    });
    shuffle(pl.deck, rng);
  }

  // Opening hands: 3 for first player, 4 + The Coin for second.
  const second = other(state.active);
  for (let i = 0; i < 3; i++) drawCard(state, state.active);
  for (let i = 0; i < 4; i++) drawCard(state, second);
  state.players[second].hand.push(createInstance(state, "coin", second));

  beginTurn(state);
  return state;
}

function emptyPlayer(heroId: string): PlayerState {
  const hero = getHero(heroId);
  return {
    hero: { health: START_HEALTH, maxHealth: START_HEALTH, armor: 0, attack: 0 },
    heroId: hero.id,
    heroPowerId: hero.heroPowerId,
    heroPowerUsed: false,
    mana: 0,
    maxMana: 0,
    hand: [],
    deck: [],
    board: [],
    fatigue: 0,
  };
}

function beginTurn(state: GameState): void {
  const pl = state.players[state.active];
  state.turn += 1;
  pl.maxMana = Math.min(MAX_MANA, pl.maxMana + 1);
  pl.mana = pl.maxMana;
  pl.heroPowerUsed = false;
  for (const m of pl.board) {
    m.summonedThisTurn = false;
    m.attacksThisTurn = 0;
  }
  drawCard(state, state.active);
  resolveDeaths(state); // fatigue can kill
}

// ---------------------------------------------------------------------------
// Legality
// ---------------------------------------------------------------------------

export function isValidTarget(
  state: GameState,
  spec: TargetSpec,
  controller: PlayerIndex,
  ref: CharRef,
): boolean {
  const t = resolve(state, ref);
  if (!t) return false;
  if (spec.kind === "minion" && !t.minion) return false;
  if (spec.side === "enemy" && t.owner === controller) return false;
  if (spec.side === "friendly" && t.owner !== controller) return false;
  return true;
}

/** Enemy minions with taunt, which constrain attack targets. */
function enemyTaunts(state: GameState, attackerOwner: PlayerIndex): CardInstance[] {
  return state.players[other(attackerOwner)].board.filter((m) =>
    hasKeyword(m, "taunt"),
  );
}

export function canAttack(_state: GameState, m: CardInstance): boolean {
  if (m.attack <= 0 || m.frozen) return false;
  const maxAttacks = hasKeyword(m, "windfury") ? 2 : 1;
  if (m.attacksThisTurn >= maxAttacks) return false;
  if (m.summonedThisTurn && !hasKeyword(m, "charge") && !hasKeyword(m, "rush"))
    return false;
  return true;
}

export function validateAction(state: GameState, action: Action): string | null {
  if (state.phase !== "playing") return "Game is over";
  if (action.player !== state.active) return "Not your turn";
  const pl = state.players[action.player];

  switch (action.type) {
    case "END_TURN":
      return null;

    case "PLAY_CARD": {
      const card = pl.hand.find((c) => c.instanceId === action.instanceId);
      if (!card) return "Card not in hand";
      const def = getCardDef(card.defId);
      if (def.cost > pl.mana) return "Not enough mana";
      if (def.type === "minion" && pl.board.length >= MAX_BOARD)
        return "Board is full";
      if (def.requiresTarget) {
        if (!action.target) return "This card needs a target";
        if (!isValidTarget(state, def.requiresTarget, action.player, action.target))
          return "Invalid target";
      }
      return null;
    }

    case "ATTACK": {
      const attacker = pl.board.find((m) => m.instanceId === action.attacker);
      if (!attacker) return "Attacker not on your board";
      if (!canAttack(state, attacker)) return "That minion cannot attack";
      const t = resolve(state, action.target);
      if (!t) return "Target not found";
      if (t.owner === action.player) return "Cannot attack your own side";
      if (
        m_isRushOnly(attacker) &&
        action.target.kind === "hero"
      )
        return "Rush minions cannot attack heroes the turn they are played";
      const taunts = enemyTaunts(state, action.player);
      if (taunts.length > 0) {
        const target = action.target;
        const hittingTaunt =
          target.kind === "minion" &&
          taunts.some((m) => m.instanceId === target.instanceId);
        if (!hittingTaunt) return "You must attack a Taunt minion";
      }
      return null;
    }

    case "HERO_POWER": {
      if (pl.heroPowerUsed) return "Hero power already used this turn";
      const hp = getHeroPower(pl.heroPowerId);
      if (hp.cost > pl.mana) return "Not enough mana";
      if (hp.requiresTarget) {
        if (!action.target) return "Hero power needs a target";
        if (!isValidTarget(state, hp.requiresTarget, action.player, action.target))
          return "Invalid target";
      }
      return null;
    }
  }
}

function m_isRushOnly(m: CardInstance): boolean {
  return m.summonedThisTurn && hasKeyword(m, "rush") && !hasKeyword(m, "charge");
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export function applyAction(prev: GameState, action: Action): GameState {
  const err = validateAction(prev, action);
  if (err) throw new Error(err);
  const state = structuredClone(prev);
  const pl = state.players[action.player];
  const rng = makeRng(state);

  switch (action.type) {
    case "END_TURN": {
      state.log.push(`P${action.player + 1} ended turn ${state.turn}`);
      // Thaw the ending player's minions: freeze costs a minion its next turn.
      for (const m of pl.board) m.frozen = false;
      state.active = other(state.active);
      beginTurn(state);
      break;
    }

    case "PLAY_CARD": {
      const idx = pl.hand.findIndex((c) => c.instanceId === action.instanceId);
      const [card] = pl.hand.splice(idx, 1);
      const def = getCardDef(card.defId);
      pl.mana -= def.cost;
      state.log.push(`P${action.player + 1} played ${def.name}`);

      if (def.type === "minion") {
        const pos =
          action.position == null
            ? pl.board.length
            : Math.max(0, Math.min(action.position, pl.board.length));
        card.summonedThisTurn = true;
        card.attacksThisTurn = 0;
        pl.board.splice(pos, 0, card);
        def.battlecry?.({
          state,
          controller: action.player,
          source: card,
          target: action.target ?? null,
          rng,
        });
      } else {
        def.onCast?.({
          state,
          controller: action.player,
          source: null,
          target: action.target ?? null,
          rng,
        });
      }
      resolveDeaths(state);
      break;
    }

    case "ATTACK": {
      const attacker = pl.board.find((m) => m.instanceId === action.attacker)!;
      attacker.attacksThisTurn += 1;
      const t = resolve(state, action.target)!;
      const attackerRef: CharRef = { kind: "minion", instanceId: attacker.instanceId };
      if (t.minion) {
        state.log.push(
          `${getCardDef(attacker.defId).name} attacked ${getCardDef(t.minion.defId).name}`,
        );
        dealDamage(state, action.target, attacker.attack);
        dealDamage(state, attackerRef, t.minion.attack);
      } else {
        state.log.push(`${getCardDef(attacker.defId).name} attacked the enemy hero`);
        dealDamage(state, action.target, attacker.attack);
      }
      resolveDeaths(state);
      break;
    }

    case "HERO_POWER": {
      const hp = getHeroPower(pl.heroPowerId);
      pl.mana -= hp.cost;
      pl.heroPowerUsed = true;
      state.log.push(`P${action.player + 1} used ${hp.name}`);
      hp.effect({
        state,
        controller: action.player,
        source: null,
        target: action.target ?? null,
        rng,
      });
      resolveDeaths(state);
      break;
    }
  }

  return state;
}

// ---------------------------------------------------------------------------
// Move enumeration (used by the AI and for UI affordances)
// ---------------------------------------------------------------------------

export function legalActions(state: GameState, p: PlayerIndex): Action[] {
  if (state.phase !== "playing" || state.active !== p) return [];
  const actions: Action[] = [{ type: "END_TURN", player: p }];
  const pl = state.players[p];
  const enemy = other(p);

  const allTargets = (spec: TargetSpec): CharRef[] => {
    const refs: CharRef[] = [];
    for (const side of [0, 1] as const) {
      if (spec.side === "enemy" && side === p) continue;
      if (spec.side === "friendly" && side !== p) continue;
      if (spec.kind === "character")
        refs.push({ kind: "hero", player: side });
      for (const m of state.players[side].board)
        refs.push({ kind: "minion", instanceId: m.instanceId });
    }
    return refs.filter((r) => isValidTarget(state, spec, p, r));
  };

  for (const card of pl.hand) {
    const def = getCardDef(card.defId);
    if (def.cost > pl.mana) continue;
    if (def.type === "minion" && pl.board.length >= MAX_BOARD) continue;
    if (def.requiresTarget) {
      for (const target of allTargets(def.requiresTarget)) {
        const a: Action = { type: "PLAY_CARD", player: p, instanceId: card.instanceId, target };
        if (!validateAction(state, a)) actions.push(a);
      }
    } else {
      actions.push({ type: "PLAY_CARD", player: p, instanceId: card.instanceId });
    }
  }

  const taunts = enemyTaunts(state, p);
  const attackTargets: CharRef[] =
    taunts.length > 0
      ? taunts.map((m) => ({ kind: "minion" as const, instanceId: m.instanceId }))
      : [
          { kind: "hero" as const, player: enemy },
          ...state.players[enemy].board.map((m) => ({
            kind: "minion" as const,
            instanceId: m.instanceId,
          })),
        ];
  for (const m of pl.board) {
    if (!canAttack(state, m)) continue;
    for (const target of attackTargets) {
      const a: Action = { type: "ATTACK", player: p, attacker: m.instanceId, target };
      if (!validateAction(state, a)) actions.push(a);
    }
  }

  if (!pl.heroPowerUsed) {
    const hp = getHeroPower(pl.heroPowerId);
    if (hp.cost <= pl.mana) {
      if (hp.requiresTarget) {
        for (const target of allTargets(hp.requiresTarget))
          actions.push({ type: "HERO_POWER", player: p, target });
      } else {
        actions.push({ type: "HERO_POWER", player: p });
      }
    }
  }

  return actions;
}
