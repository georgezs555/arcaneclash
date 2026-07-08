import { describe, it, expect } from "vitest";
import {
  allHeroes,
  createGame,
  createInstance,
  applyAction,
  canAttack,
  legalActions,
  chooseAction,
  getCardDef,
  redactState,
  starterDeckFor,
  validateDeck,
  type GameState,
  type PlayerIndex,
  type CharRef,
} from "./index";

/** A game still sitting in the mulligan phase. */
function rawGame(seed = 42, first: PlayerIndex = 0): GameState {
  return createGame({
    decks: [starterDeckFor("merlin"), starterDeckFor("lancelot")],
    heroes: ["merlin", "lancelot"],
    seed,
    first,
  });
}

/** A game with both mulligans submitted (keeping everything). */
function newGame(seed = 42, first: PlayerIndex = 0): GameState {
  let g = rawGame(seed, first);
  g = applyAction(g, { type: "MULLIGAN", player: 0, replace: [] });
  g = applyAction(g, { type: "MULLIGAN", player: 1, replace: [] });
  return g;
}

/** Force a card into the active player's hand for deterministic tests. */
function putInHand(state: GameState, defId: string): string {
  const p = state.active;
  const idx = state.players[p].deck.findIndex((c) => c.defId === defId);
  let card;
  if (idx >= 0) {
    [card] = state.players[p].deck.splice(idx, 1);
  } else {
    card = createInstance(state, defId, p);
    card.summonedThisTurn = false;
  }
  state.players[p].hand.push(card);
  return card.instanceId;
}

function giveMana(state: GameState, amount: number) {
  state.players[state.active].mana = amount;
  state.players[state.active].maxMana = amount;
}

describe("mulligan", () => {
  it("game starts in the mulligan phase; turn actions are rejected", () => {
    const g = rawGame();
    expect(g.phase).toBe("mulligan");
    expect(() => applyAction(g, { type: "END_TURN", player: 0 })).toThrow(
      /hasn't started/,
    );
  });

  it("replaced cards are swapped for new ones and shuffled back", () => {
    const g0 = rawGame();
    const before = g0.players[0].hand.map((c) => c.instanceId);
    const deckBefore = g0.players[0].deck.length;
    const g1 = applyAction(g0, { type: "MULLIGAN", player: 0, replace: before });
    expect(g1.players[0].hand.length).toBe(before.length);
    expect(
      g1.players[0].hand.every((c) => !before.includes(c.instanceId)),
    ).toBe(true);
    expect(g1.players[0].deck.length).toBe(deckBefore); // net zero
    expect(g1.players[0].mulliganDone).toBe(true);
    expect(g1.phase).toBe("mulligan"); // opponent still deciding
  });

  it("second mulligan starts the game: coin, mana, turn draw", () => {
    const g0 = rawGame(42, 0);
    const g1 = applyAction(g0, { type: "MULLIGAN", player: 0, replace: [] });
    const g2 = applyAction(g1, { type: "MULLIGAN", player: 1, replace: [] });
    expect(g2.phase).toBe("playing");
    expect(g2.turn).toBe(1);
    expect(g2.players[0].hand.length).toBe(4); // 3 + turn-start draw
    expect(g2.players[1].hand.length).toBe(5); // 4 + coin
    expect(g2.players[1].hand.some((c) => c.defId === "coin")).toBe(true);
    expect(g2.players[0].mana).toBe(1);
  });

  it("cannot mulligan twice or reject cards you don't hold", () => {
    const g0 = rawGame();
    const g1 = applyAction(g0, { type: "MULLIGAN", player: 0, replace: [] });
    expect(() =>
      applyAction(g1, { type: "MULLIGAN", player: 0, replace: [] }),
    ).toThrow(/already submitted/);
    expect(() =>
      applyAction(g1, { type: "MULLIGAN", player: 1, replace: ["nope"] }),
    ).toThrow(/not in your hand/);
  });

  it("AI mulligans away expensive cards only", () => {
    const g = rawGame();
    const action = chooseAction(g, 0);
    expect(action.type).toBe("MULLIGAN");
    if (action.type !== "MULLIGAN") return;
    const hand = g.players[0].hand;
    for (const c of hand) {
      const cost = getCardDef(c.defId).cost;
      expect(action.replace.includes(c.instanceId)).toBe(cost >= 4);
    }
  });
});

describe("game setup", () => {
  it("deals 3 cards to first player, 4 + coin to second", () => {
    const g = newGame();
    expect(g.players[0].hand.length).toBe(3 + 1); // +1 from turn-start draw
    expect(g.players[1].hand.length).toBe(5);
    expect(g.players[1].hand.some((c) => c.defId === "coin")).toBe(true);
  });

  it("starts with 1 mana on turn 1", () => {
    const g = newGame();
    expect(g.players[0].mana).toBe(1);
    expect(g.players[0].maxMana).toBe(1);
  });

  it("is deterministic for a given seed", () => {
    const a = newGame(7);
    const b = newGame(7);
    expect(a).toEqual(b);
  });
});

describe("mana and turns", () => {
  it("increments max mana each turn, capped at 10", () => {
    let g = newGame();
    for (let i = 0; i < 25; i++) g = applyAction(g, { type: "END_TURN", player: g.active });
    expect(g.players[0].maxMana).toBe(10);
    expect(g.players[1].maxMana).toBe(10);
  });

  it("coin grants temporary mana", () => {
    let g = newGame(42, 0);
    g = applyAction(g, { type: "END_TURN", player: 0 });
    const coin = g.players[1].hand.find((c) => c.defId === "coin")!;
    g = applyAction(g, { type: "PLAY_CARD", player: 1, instanceId: coin.instanceId });
    expect(g.players[1].mana).toBe(2);
    expect(g.players[1].maxMana).toBe(1);
  });
});

describe("playing minions and attacking", () => {
  it("plays a minion, which cannot attack same turn without charge", () => {
    const g0 = newGame();
    const id = putInHand(g0, "river_skulker");
    const g1 = applyAction(g0, { type: "PLAY_CARD", player: 0, instanceId: id });
    expect(g1.players[0].board.length).toBe(1);
    const attacks = legalActions(g1, 0).filter((a) => a.type === "ATTACK");
    expect(attacks.length).toBe(0);
  });

  it("charge minions can attack immediately", () => {
    const g0 = newGame();
    giveMana(g0, 10);
    const id = putInHand(g0, "sparkfist_brawler");
    const g1 = applyAction(g0, { type: "PLAY_CARD", player: 0, instanceId: id });
    const minion = g1.players[0].board[0];
    const g2 = applyAction(g1, {
      type: "ATTACK",
      player: 0,
      attacker: minion.instanceId,
      target: { kind: "hero", player: 1 },
    });
    expect(g2.players[1].hero.health).toBe(28);
  });

  it("rush minions can attack minions but not heroes on summon turn", () => {
    let g = newGame();
    giveMana(g, 10);
    // Give the enemy a minion to hit.
    const skulkId = putInHand(g, "river_skulker");
    g = applyAction(g, { type: "PLAY_CARD", player: 0, instanceId: skulkId });
    g = applyAction(g, { type: "END_TURN", player: 0 });
    giveMana(g, 10);
    const rushId = putInHand(g, "ridge_charger");
    g = applyAction(g, { type: "PLAY_CARD", player: 1, instanceId: rushId });
    const rusher = g.players[1].board[0];
    expect(() =>
      applyAction(g, {
        type: "ATTACK",
        player: 1,
        attacker: rusher.instanceId,
        target: { kind: "hero", player: 0 },
      }),
    ).toThrow();
    const enemyMinion = g.players[0].board[0];
    const g2 = applyAction(g, {
      type: "ATTACK",
      player: 1,
      attacker: rusher.instanceId,
      target: { kind: "minion", instanceId: enemyMinion.instanceId },
    });
    expect(g2.players[0].board.length).toBe(0); // 5 atk kills the 2/1
  });

  it("taunt forces attacks onto it", () => {
    let g = newGame();
    giveMana(g, 10);
    const chargeId = putInHand(g, "sparkfist_brawler");
    g = applyAction(g, { type: "PLAY_CARD", player: 0, instanceId: chargeId });
    g = applyAction(g, { type: "END_TURN", player: 0 });
    giveMana(g, 10);
    const tauntId = putInHand(g, "stonehide_guard");
    g = applyAction(g, { type: "PLAY_CARD", player: 1, instanceId: tauntId });
    g = applyAction(g, { type: "END_TURN", player: 1 });
    const attacker = g.players[0].board[0];
    expect(() =>
      applyAction(g, {
        type: "ATTACK",
        player: 0,
        attacker: attacker.instanceId,
        target: { kind: "hero", player: 1 },
      }),
    ).toThrow(/Taunt/);
  });

  it("windfury allows two attacks", () => {
    let g = newGame();
    giveMana(g, 10);
    const id = putInHand(g, "duskwing_harrier");
    g = applyAction(g, { type: "PLAY_CARD", player: 0, instanceId: id });
    g = applyAction(g, { type: "END_TURN", player: 0 });
    g = applyAction(g, { type: "END_TURN", player: 1 });
    const m = g.players[0].board[0];
    g = applyAction(g, { type: "ATTACK", player: 0, attacker: m.instanceId, target: { kind: "hero", player: 1 } });
    g = applyAction(g, { type: "ATTACK", player: 0, attacker: m.instanceId, target: { kind: "hero", player: 1 } });
    expect(g.players[1].hero.health).toBe(24);
    expect(() =>
      applyAction(g, { type: "ATTACK", player: 0, attacker: m.instanceId, target: { kind: "hero", player: 1 } }),
    ).toThrow();
  });

  it("divine shield absorbs one hit", () => {
    let g = newGame();
    giveMana(g, 10);
    const id = putInHand(g, "sunforged_acolyte");
    g = applyAction(g, { type: "PLAY_CARD", player: 0, instanceId: id });
    const m = g.players[0].board[0];
    const ref: CharRef = { kind: "minion", instanceId: m.instanceId };
    const boltId = putInHand(g, "ember_bolt");
    g = applyAction(g, { type: "PLAY_CARD", player: 0, instanceId: boltId, target: ref });
    expect(g.players[0].board[0].health).toBe(3);
    expect(g.players[0].board[0].divineShield).toBe(false);
  });
});

describe("effects", () => {
  it("battlecry draw (Hedge Scholar) draws a card", () => {
    const g0 = newGame();
    giveMana(g0, 10);
    const id = putInHand(g0, "hedge_scholar");
    const handBefore = g0.players[0].hand.length;
    const g1 = applyAction(g0, { type: "PLAY_CARD", player: 0, instanceId: id });
    expect(g1.players[0].hand.length).toBe(handBefore); // -1 played, +1 drawn
  });

  it("deathrattle (Gravemoss Shambler) summons a token", () => {
    let g = newGame();
    giveMana(g, 10);
    const id = putInHand(g, "gravemoss_shambler");
    g = applyAction(g, { type: "PLAY_CARD", player: 0, instanceId: id });
    const m = g.players[0].board[0];
    const boltId = putInHand(g, "ember_bolt");
    g = applyAction(g, {
      type: "PLAY_CARD", player: 0, instanceId: boltId,
      target: { kind: "minion", instanceId: m.instanceId },
    });
    expect(g.players[0].board.length).toBe(1);
    expect(g.players[0].board[0].defId).toBe("emberling");
  });

  it("targeted battlecry (Stormcaller Veda) requires and hits a target", () => {
    const g0 = newGame();
    giveMana(g0, 10);
    const id = putInHand(g0, "stormcaller_veda");
    expect(() =>
      applyAction(g0, { type: "PLAY_CARD", player: 0, instanceId: id }),
    ).toThrow(/target/);
    const g1 = applyAction(g0, {
      type: "PLAY_CARD", player: 0, instanceId: id,
      target: { kind: "hero", player: 1 },
    });
    expect(g1.players[1].hero.health).toBe(28);
  });

  it("cinder nova damages all enemy minions only", () => {
    let g = newGame();
    giveMana(g, 10);
    for (const def of ["river_skulker", "boulderfang_alpha"]) {
      const id = putInHand(g, def);
      g = applyAction(g, { type: "PLAY_CARD", player: 0, instanceId: id });
    }
    g = applyAction(g, { type: "END_TURN", player: 0 });
    giveMana(g, 10);
    const mineId = putInHand(g, "river_skulker");
    g = applyAction(g, { type: "PLAY_CARD", player: 1, instanceId: mineId });
    const novaId = putInHand(g, "cinder_nova");
    g = applyAction(g, { type: "PLAY_CARD", player: 1, instanceId: novaId });
    expect(g.players[0].board.length).toBe(1); // 2/1 died, 4/5 survived at 3
    expect(g.players[0].board[0].health).toBe(3);
    expect(g.players[1].board.length).toBe(1); // own minion untouched
  });
});

describe("hero powers", () => {
  it("flame jab deals 1 damage and is once per turn", () => {
    let g = newGame();
    giveMana(g, 10);
    g = applyAction(g, { type: "HERO_POWER", player: 0, target: { kind: "hero", player: 1 } });
    expect(g.players[1].hero.health).toBe(29);
    expect(() =>
      applyAction(g, { type: "HERO_POWER", player: 0, target: { kind: "hero", player: 1 } }),
    ).toThrow(/already used/);
  });

  it("armor absorbs damage", () => {
    let g = newGame(42, 1);
    giveMana(g, 10);
    g = applyAction(g, { type: "HERO_POWER", player: 1 }); // +2 armor
    expect(g.players[1].hero.armor).toBe(2);
    const boltId = putInHand(g, "ember_bolt");
    g = applyAction(g, {
      type: "PLAY_CARD", player: 1, instanceId: boltId,
      target: { kind: "hero", player: 1 },
    });
    expect(g.players[1].hero.armor).toBe(0);
    expect(g.players[1].hero.health).toBe(29);
  });
});

describe("fatigue and game over", () => {
  it("empty deck deals escalating fatigue damage", () => {
    let g = newGame();
    g.players[0].deck = [];
    g.players[1].deck = [];
    const before = g.players[1].hero.health;
    g = applyAction(g, { type: "END_TURN", player: 0 });
    expect(g.players[1].hero.health).toBe(before - 1);
    g = applyAction(g, { type: "END_TURN", player: 1 });
    g = applyAction(g, { type: "END_TURN", player: 0 });
    expect(g.players[1].hero.health).toBe(before - 1 - 2);
  });

  it("game ends when a hero dies", () => {
    let g = newGame();
    g.players[1].hero.health = 1;
    giveMana(g, 10);
    const boltId = putInHand(g, "ember_bolt");
    g = applyAction(g, {
      type: "PLAY_CARD", player: 0, instanceId: boltId,
      target: { kind: "hero", player: 1 },
    });
    expect(g.phase).toBe("gameover");
    expect(g.winner).toBe(0);
    expect(legalActions(g, 0).length).toBe(0);
  });
});

describe("deck validation", () => {
  /** Replace the first occurrence of `from` with `to`. */
  function swap(deck: string[], from: string, to: string): string[] {
    const next = [...deck];
    next[next.indexOf(from)] = to;
    return next;
  }

  it("accepts every hero's starter deck", () => {
    for (const hero of allHeroes()) {
      expect(validateDeck(starterDeckFor(hero.id), hero.cardClass)).toBeNull();
    }
  });

  it("rejects wrong deck size", () => {
    const deck = starterDeckFor("merlin");
    expect(validateDeck(deck.slice(0, 29), "mage")).toMatch(/exactly 30/);
    expect(validateDeck([...deck, "river_skulker"], "mage")).toMatch(/exactly 30/);
  });

  it("rejects more than 2 copies of a card", () => {
    // Starter already has 2 River Skulkers; a third breaks the limit.
    const deck = swap(starterDeckFor("merlin"), "ember_bolt", "river_skulker");
    expect(validateDeck(deck, "mage")).toMatch(/Too many copies/);
  });

  it("rejects a second copy of a legendary", () => {
    let deck = swap(starterDeckFor("merlin"), "ember_bolt", "aegis_colossus");
    deck = swap(deck, "ember_bolt", "aegis_colossus");
    expect(validateDeck(deck, "mage")).toMatch(/Too many copies/);
  });

  it("rejects off-class cards", () => {
    // A warrior spell in a mage deck is illegal (class cards in their own
    // hero's starter decks are already covered by the starter-deck test).
    const deck = swap(starterDeckFor("merlin"), "ember_bolt", "rallying_strike");
    expect(validateDeck(deck, "mage")).toMatch(/can't go in this deck/);
  });

  it("rejects tokens and unknown cards", () => {
    const deck = starterDeckFor("merlin");
    expect(validateDeck(swap([...deck], "ember_bolt", "coin"), "mage")).toMatch(
      /not a collectible/,
    );
    expect(
      validateDeck(swap([...deck], "ember_bolt", "no_such_card"), "mage"),
    ).toMatch(/Unknown card/);
  });
});

describe("classes and freeze", () => {
  it("heroes carry their class hero power", () => {
    const g = createGame({
      decks: [starterDeckFor("morgana"), starterDeckFor("robin")],
      heroes: ["morgana", "robin"],
      seed: 5,
      first: 0,
    });
    expect(g.players[0].heroId).toBe("morgana");
    expect(g.players[0].heroPowerId).toBe("hp_bargain");
    expect(g.players[1].heroPowerId).toBe("hp_shot");
  });

  it("frozen minions miss one full turn, then thaw", () => {
    let g = newGame(); // P0 first
    giveMana(g, 10);
    const chargeId = putInHand(g, "sparkfist_brawler");
    g = applyAction(g, { type: "PLAY_CARD", player: 0, instanceId: chargeId });
    g = applyAction(g, { type: "END_TURN", player: 0 });

    // P1 freezes the brawler.
    giveMana(g, 10);
    const target = g.players[0].board[0];
    const frostId = putInHand(g, "frost_prison");
    g = applyAction(g, {
      type: "PLAY_CARD", player: 1, instanceId: frostId,
      target: { kind: "minion", instanceId: target.instanceId },
    });
    expect(g.players[0].board[0].frozen).toBe(true);
    g = applyAction(g, { type: "END_TURN", player: 1 });

    // P0's turn: still frozen, cannot attack.
    expect(g.players[0].board[0].frozen).toBe(true);
    expect(canAttack(g, g.players[0].board[0])).toBe(false);
    g = applyAction(g, { type: "END_TURN", player: 0 }); // thaws at end of turn
    expect(g.players[0].board[0].frozen).toBe(false);
    g = applyAction(g, { type: "END_TURN", player: 1 });
    expect(canAttack(g, g.players[0].board[0])).toBe(true);
  });

  it("Blood Bargain draws and self-damages", () => {
    let g0 = createGame({
      decks: [starterDeckFor("morgana"), starterDeckFor("merlin")],
      heroes: ["morgana", "merlin"],
      seed: 9,
      first: 0,
    });
    g0 = applyAction(g0, { type: "MULLIGAN", player: 0, replace: [] });
    g0 = applyAction(g0, { type: "MULLIGAN", player: 1, replace: [] });
    giveMana(g0, 10);
    const handBefore = g0.players[0].hand.length;
    const g1 = applyAction(g0, { type: "HERO_POWER", player: 0 });
    expect(g1.players[0].hand.length).toBe(handBefore + 1);
    expect(g1.players[0].hero.health).toBe(28);
  });
});

describe("redaction", () => {
  it("hides opponent hand, both decks, and rng — but not own hand", () => {
    const g = newGame();
    const r = redactState(g, 0);
    expect(r.players[1].hand.every((c) => c.defId === "hidden")).toBe(true);
    expect(r.players[0].hand.every((c) => c.defId !== "hidden")).toBe(true);
    expect(r.players[0].deck.every((c) => c.defId === "hidden")).toBe(true);
    expect(r.players[1].deck.every((c) => c.defId === "hidden")).toBe(true);
    expect(r.rng).toBe(0);
    // Public zones stay intact.
    expect(r.players[1].hero.health).toBe(g.players[1].hero.health);
    expect(r.players[1].hand.length).toBe(g.players[1].hand.length);
    // Original state untouched.
    expect(g.players[1].hand.some((c) => c.defId !== "hidden")).toBe(true);
  });
});

describe("AI self-play", () => {
  it("two AIs can finish a full game (including mulligan) without errors", () => {
    for (const seed of [1, 2, 3]) {
      let g = rawGame(seed);
      let safety = 2000;
      while (g.phase !== "gameover" && safety-- > 0) {
        const p: PlayerIndex =
          g.phase === "mulligan" ? (g.players[0].mulliganDone ? 1 : 0) : g.active;
        g = applyAction(g, chooseAction(g, p));
      }
      expect(g.phase).toBe("gameover");
      expect(g.winner).not.toBeNull();
    }
  });
});
