// Starter card set. All names, art descriptors and flavor are original to this
// project — the set is designed to exercise every engine mechanic, and is meant
// to be replaced/expanded via the registry later.

import {
  collectibleCards,
  getHero,
  registerCard,
  registerHero,
  registerHeroPower,
} from "./registry";
import {
  buff,
  dealDamage,
  drawCard,
  freezeMinion,
  giveDivineShield,
  healChar,
  other,
  setMinionAttack,
  summonMinion,
} from "./mechanics";
import type { CharRef, EffectContext } from "./types";

// --- helpers ---------------------------------------------------------------

function allEnemyMinions(ctx: EffectContext): CharRef[] {
  return ctx.state.players[other(ctx.controller)].board.map((m) => ({
    kind: "minion" as const,
    instanceId: m.instanceId,
  }));
}

function randomEnemyCharacter(ctx: EffectContext): CharRef {
  const refs: CharRef[] = [
    { kind: "hero", player: other(ctx.controller) },
    ...allEnemyMinions(ctx),
  ];
  return refs[Math.floor(ctx.rng() * refs.length)];
}

// --- tokens & utility --------------------------------------------------------

registerCard({
  id: "coin",
  name: "Lucky Coin",
  cost: 0,
  type: "spell",
  text: "Gain 1 Mana Crystal this turn only.",
  token: true,
  onCast: ({ state, controller }) => {
    const pl = state.players[controller];
    pl.mana = Math.min(10, pl.mana + 1);
  },
});

// Placeholder def that redacted cards point at (see redact.ts).
registerCard({
  id: "hidden",
  name: "???",
  cost: 0,
  type: "minion",
  attack: 0,
  health: 0,
  token: true,
});

registerCard({
  id: "emberling",
  name: "Emberling",
  cost: 1,
  type: "minion",
  attack: 1,
  health: 1,
  token: true,
});

// --- minions -----------------------------------------------------------------

registerCard({
  id: "river_skulker",
  name: "River Skulker",
  cost: 1,
  type: "minion",
  rarity: "basic",
  attack: 2,
  health: 1,
});

registerCard({
  id: "stonehide_guard",
  name: "Stonehide Guard",
  cost: 2,
  type: "minion",
  rarity: "basic",
  attack: 2,
  health: 3,
  keywords: ["taunt"],
  text: "Taunt.",
});

registerCard({
  id: "hedge_scholar",
  name: "Hedge Scholar",
  cost: 2,
  type: "minion",
  rarity: "common",
  attack: 1,
  health: 2,
  text: "Battlecry: Draw a card.",
  battlecry: ({ state, controller }) => {
    drawCard(state, controller);
  },
});

registerCard({
  id: "sparkfist_brawler",
  name: "Sparkfist Brawler",
  cost: 3,
  type: "minion",
  rarity: "common",
  attack: 2,
  health: 2,
  keywords: ["charge"],
  text: "Charge.",
});

registerCard({
  id: "gravemoss_shambler",
  name: "Gravemoss Shambler",
  cost: 3,
  type: "minion",
  rarity: "common",
  attack: 3,
  health: 2,
  text: "Deathrattle: Summon a 1/1 Emberling.",
  deathrattle: ({ state, controller }) => {
    summonMinion(state, controller, "emberling");
  },
});

registerCard({
  id: "duskwing_harrier",
  name: "Duskwing Harrier",
  cost: 3,
  type: "minion",
  rarity: "rare",
  attack: 3,
  health: 1,
  keywords: ["windfury"],
  text: "Windfury.",
});

registerCard({
  id: "sunforged_acolyte",
  name: "Sunforged Acolyte",
  cost: 4,
  type: "minion",
  rarity: "rare",
  attack: 3,
  health: 3,
  keywords: ["divineShield"],
  text: "Divine Shield.",
});

registerCard({
  id: "boulderfang_alpha",
  name: "Boulderfang Alpha",
  cost: 4,
  type: "minion",
  rarity: "common",
  attack: 4,
  health: 5,
});

registerCard({
  id: "warden_of_the_gate",
  name: "Warden of the Gate",
  cost: 5,
  type: "minion",
  rarity: "common",
  attack: 3,
  health: 6,
  keywords: ["taunt"],
  text: "Taunt.",
});

registerCard({
  id: "stormcaller_veda",
  name: "Stormcaller Veda",
  cost: 5,
  type: "minion",
  rarity: "epic",
  attack: 4,
  health: 4,
  text: "Battlecry: Deal 2 damage.",
  requiresTarget: { side: "any", kind: "character" },
  battlecry: (ctx) => {
    if (ctx.target) dealDamage(ctx.state, ctx.target, 2);
  },
});

registerCard({
  id: "ridge_charger",
  name: "Ridge Charger",
  cost: 6,
  type: "minion",
  rarity: "common",
  attack: 5,
  health: 4,
  keywords: ["rush"],
  text: "Rush.",
});

registerCard({
  id: "aegis_colossus",
  name: "Aegis Colossus",
  cost: 7,
  type: "minion",
  rarity: "legendary",
  attack: 6,
  health: 7,
  keywords: ["taunt", "divineShield"],
  text: "Taunt. Divine Shield.",
});

// --- spells --------------------------------------------------------------------

registerCard({
  id: "ember_bolt",
  name: "Ember Bolt",
  cost: 1,
  type: "spell",
  rarity: "basic",
  text: "Deal 3 damage.",
  requiresTarget: { side: "any", kind: "character" },
  onCast: (ctx) => {
    if (ctx.target) dealDamage(ctx.state, ctx.target, 3);
  },
});

registerCard({
  id: "mend_flesh",
  name: "Mend Flesh",
  cost: 2,
  type: "spell",
  rarity: "basic",
  text: "Restore 5 Health.",
  requiresTarget: { side: "any", kind: "character" },
  onCast: (ctx) => {
    if (ctx.target) healChar(ctx.state, ctx.target, 5);
  },
});

registerCard({
  id: "battle_hymn",
  name: "Battle Hymn",
  cost: 2,
  type: "spell",
  rarity: "common",
  text: "Give a minion +2/+2.",
  requiresTarget: { side: "any", kind: "minion" },
  onCast: (ctx) => {
    if (ctx.target) buff(ctx.state, ctx.target, 2, 2);
  },
});

registerCard({
  id: "chain_sparks",
  name: "Chain Sparks",
  cost: 3,
  type: "spell",
  rarity: "rare",
  text: "Deal 1 damage to a random enemy 4 times.",
  onCast: (ctx) => {
    for (let i = 0; i < 4; i++) {
      dealDamage(ctx.state, randomEnemyCharacter(ctx), 1);
    }
  },
});

registerCard({
  id: "cinder_nova",
  name: "Cinder Nova",
  cost: 4,
  type: "spell",
  rarity: "rare",
  text: "Deal 2 damage to all enemy minions.",
  onCast: (ctx) => {
    for (const ref of allEnemyMinions(ctx)) dealDamage(ctx.state, ref, 2);
  },
});

registerCard({
  id: "tomes_of_insight",
  name: "Tomes of Insight",
  cost: 3,
  type: "spell",
  rarity: "common",
  text: "Draw 2 cards.",
  onCast: ({ state, controller }) => {
    drawCard(state, controller);
    drawCard(state, controller);
  },
});

// === class cards ===============================================================

// --- Mage (Merlin) ---

registerCard({
  id: "arcane_dart",
  name: "Arcane Dart",
  cost: 1,
  type: "spell",
  cardClass: "mage",
  rarity: "basic",
  text: "Deal 2 damage.",
  requiresTarget: { side: "any", kind: "character" },
  onCast: (ctx) => {
    if (ctx.target) dealDamage(ctx.state, ctx.target, 2);
  },
});

registerCard({
  id: "frost_prison",
  name: "Frost Prison",
  cost: 2,
  type: "spell",
  cardClass: "mage",
  rarity: "common",
  text: "Freeze an enemy minion.",
  requiresTarget: { side: "enemy", kind: "minion" },
  onCast: (ctx) => {
    if (ctx.target) freezeMinion(ctx.state, ctx.target);
  },
});

registerCard({
  id: "starfall_adept",
  name: "Starfall Adept",
  cost: 4,
  type: "minion",
  cardClass: "mage",
  rarity: "rare",
  attack: 3,
  health: 4,
  text: "Battlecry: Deal 1 damage to all enemy minions.",
  battlecry: (ctx) => {
    for (const ref of allEnemyMinions(ctx)) dealDamage(ctx.state, ref, 1);
  },
});

// --- Warlock (Morgana) ---

registerCard({
  id: "gloom_imp",
  name: "Gloom Imp",
  cost: 1,
  type: "minion",
  cardClass: "warlock",
  rarity: "common",
  attack: 3,
  health: 2,
  text: "Battlecry: Deal 2 damage to your own hero.",
  battlecry: ({ state, controller }) => {
    dealDamage(state, { kind: "hero", player: controller }, 2);
  },
});

registerCard({
  id: "soul_tithe",
  name: "Soul Tithe",
  cost: 2,
  type: "spell",
  cardClass: "warlock",
  rarity: "basic",
  text: "Draw 2 cards. Deal 3 damage to your own hero.",
  onCast: ({ state, controller }) => {
    drawCard(state, controller);
    drawCard(state, controller);
    dealDamage(state, { kind: "hero", player: controller }, 3);
  },
});

registerCard({
  id: "shadow_rend",
  name: "Shadow Rend",
  cost: 3,
  type: "spell",
  cardClass: "warlock",
  rarity: "rare",
  text: "Deal 4 damage to a minion. Deal 2 damage to your own hero.",
  requiresTarget: { side: "any", kind: "minion" },
  onCast: (ctx) => {
    if (!ctx.target) return;
    dealDamage(ctx.state, ctx.target, 4);
    dealDamage(ctx.state, { kind: "hero", player: ctx.controller }, 2);
  },
});

// --- Paladin (Parcifal) ---

registerCard({
  id: "oath_of_dawn",
  name: "Oath of Dawn",
  cost: 1,
  type: "spell",
  cardClass: "paladin",
  rarity: "common",
  text: "Give a minion Divine Shield.",
  requiresTarget: { side: "any", kind: "minion" },
  onCast: (ctx) => {
    if (ctx.target) giveDivineShield(ctx.state, ctx.target);
  },
});

registerCard({
  id: "squire_muster",
  name: "Squire Muster",
  cost: 2,
  type: "spell",
  cardClass: "paladin",
  rarity: "basic",
  text: "Summon two 1/1 Squires.",
  onCast: ({ state, controller }) => {
    summonMinion(state, controller, "squire");
    summonMinion(state, controller, "squire");
  },
});

registerCard({
  id: "grail_knight",
  name: "Grail Knight",
  cost: 4,
  type: "minion",
  cardClass: "paladin",
  rarity: "rare",
  attack: 3,
  health: 4,
  keywords: ["divineShield"],
  text: "Divine Shield.",
});

// --- Warrior (Lancelot) ---

registerCard({
  id: "rallying_strike",
  name: "Rallying Strike",
  cost: 1,
  type: "spell",
  cardClass: "warrior",
  rarity: "common",
  text: "Give a friendly minion +2 Attack.",
  requiresTarget: { side: "friendly", kind: "minion" },
  onCast: (ctx) => {
    if (ctx.target) buff(ctx.state, ctx.target, 2, 0);
  },
});

registerCard({
  id: "iron_bulwark",
  name: "Iron Bulwark",
  cost: 3,
  type: "spell",
  cardClass: "warrior",
  rarity: "basic",
  text: "Gain 4 Armor. Draw a card.",
  onCast: ({ state, controller }) => {
    state.players[controller].hero.armor += 4;
    drawCard(state, controller);
  },
});

registerCard({
  id: "tourney_champion",
  name: "Tourney Champion",
  cost: 5,
  type: "minion",
  cardClass: "warrior",
  rarity: "rare",
  attack: 5,
  health: 5,
  text: "Battlecry: Gain 4 Armor.",
  battlecry: ({ state, controller }) => {
    state.players[controller].hero.armor += 4;
  },
});

// --- Priest (Martin) ---

registerCard({
  id: "radiant_light",
  name: "Radiant Light",
  cost: 1,
  type: "spell",
  cardClass: "priest",
  rarity: "basic",
  text: "Restore 4 Health.",
  requiresTarget: { side: "any", kind: "character" },
  onCast: (ctx) => {
    if (ctx.target) healChar(ctx.state, ctx.target, 4);
  },
});

registerCard({
  id: "humble_words",
  name: "Humble Words",
  cost: 2,
  type: "spell",
  cardClass: "priest",
  rarity: "rare",
  text: "Set a minion's Attack to 1.",
  requiresTarget: { side: "any", kind: "minion" },
  onCast: (ctx) => {
    if (ctx.target) setMinionAttack(ctx.state, ctx.target, 1);
  },
});

registerCard({
  id: "cloister_healer",
  name: "Cloister Healer",
  cost: 4,
  type: "minion",
  cardClass: "priest",
  rarity: "common",
  attack: 3,
  health: 5,
  text: "Battlecry: Restore 3 Health.",
  requiresTarget: { side: "any", kind: "character" },
  battlecry: (ctx) => {
    if (ctx.target) healChar(ctx.state, ctx.target, 3);
  },
});

// --- Hunter (Robin Hood) ---

registerCard({
  id: "trusty_hound",
  name: "Trusty Hound",
  cost: 1,
  type: "minion",
  cardClass: "hunter",
  rarity: "common",
  attack: 2,
  health: 1,
  keywords: ["rush"],
  text: "Rush.",
});

registerCard({
  id: "pack_call",
  name: "Pack Call",
  cost: 3,
  type: "spell",
  cardClass: "hunter",
  rarity: "basic",
  text: "Summon two 2/1 Wolves.",
  onCast: ({ state, controller }) => {
    summonMinion(state, controller, "wolf");
    summonMinion(state, controller, "wolf");
  },
});

registerCard({
  id: "ambush_volley",
  name: "Ambush Volley",
  cost: 3,
  type: "spell",
  cardClass: "hunter",
  rarity: "rare",
  text: "Deal 3 damage to two random enemy minions.",
  onCast: (ctx) => {
    for (let i = 0; i < 2; i++) {
      const alive = ctx.state.players[other(ctx.controller)].board.filter(
        (m) => m.health > 0,
      );
      if (alive.length === 0) break;
      const pick = alive[Math.floor(ctx.rng() * alive.length)];
      dealDamage(ctx.state, { kind: "minion", instanceId: pick.instanceId }, 3);
    }
  },
});

// --- class tokens ---

registerCard({
  id: "squire",
  name: "Squire",
  cost: 1,
  type: "minion",
  attack: 1,
  health: 1,
  token: true,
});

registerCard({
  id: "wolf",
  name: "Wolf",
  cost: 1,
  type: "minion",
  attack: 2,
  health: 1,
  token: true,
});

// === hero powers ===============================================================

registerHeroPower({
  id: "hp_flame",
  name: "Flame Jab",
  cost: 2,
  text: "Deal 1 damage.",
  requiresTarget: { side: "any", kind: "character" },
  effect: (ctx) => {
    if (ctx.target) dealDamage(ctx.state, ctx.target, 1);
  },
});

registerHeroPower({
  id: "hp_bargain",
  name: "Blood Bargain",
  cost: 2,
  text: "Draw a card. Deal 2 damage to your own hero.",
  effect: ({ state, controller }) => {
    drawCard(state, controller);
    dealDamage(state, { kind: "hero", player: controller }, 2);
  },
});

registerHeroPower({
  id: "hp_rally",
  name: "Rally Squire",
  cost: 2,
  text: "Summon a 1/1 Squire.",
  effect: ({ state, controller }) => {
    summonMinion(state, controller, "squire");
  },
});

registerHeroPower({
  id: "hp_bulwark",
  name: "Raise Bulwark",
  cost: 2,
  text: "Gain 2 Armor.",
  effect: ({ state, controller }) => {
    state.players[controller].hero.armor += 2;
  },
});

registerHeroPower({
  id: "hp_mend",
  name: "Gentle Mend",
  cost: 2,
  text: "Restore 2 Health.",
  requiresTarget: { side: "any", kind: "character" },
  effect: (ctx) => {
    if (ctx.target) healChar(ctx.state, ctx.target, 2);
  },
});

registerHeroPower({
  id: "hp_shot",
  name: "Piercing Shot",
  cost: 2,
  text: "Deal 2 damage to the enemy hero.",
  effect: ({ state, controller }) => {
    dealDamage(state, { kind: "hero", player: other(controller) }, 2);
  },
});

// === heroes ====================================================================

registerHero({ id: "merlin", name: "Merlin", cardClass: "mage", heroPowerId: "hp_flame" });
registerHero({ id: "morgana", name: "Morgana", cardClass: "warlock", heroPowerId: "hp_bargain" });
registerHero({ id: "parcifal", name: "Parcifal", cardClass: "paladin", heroPowerId: "hp_rally" });
registerHero({ id: "lancelot", name: "Lancelot", cardClass: "warrior", heroPowerId: "hp_bulwark" });
registerHero({ id: "martin", name: "Martin", cardClass: "priest", heroPowerId: "hp_mend" });
registerHero({ id: "robin", name: "Robin Hood", cardClass: "hunter", heroPowerId: "hp_shot" });

// === starter decks =============================================================

/** Neutral core shared by every hero's starter deck (24 cards). */
export const STARTER_CORE: string[] = [
  "river_skulker", "river_skulker",
  "ember_bolt", "ember_bolt",
  "stonehide_guard", "stonehide_guard",
  "hedge_scholar", "hedge_scholar",
  "mend_flesh", "mend_flesh",
  "battle_hymn", "battle_hymn",
  "sparkfist_brawler", "sparkfist_brawler",
  "gravemoss_shambler", "gravemoss_shambler",
  "tomes_of_insight", "tomes_of_insight",
  "sunforged_acolyte", "sunforged_acolyte",
  "boulderfang_alpha", "boulderfang_alpha",
  "warden_of_the_gate", "warden_of_the_gate",
];

/** The hero's ready-made deck: neutral core + 2 copies of each class card. */
export function starterDeckFor(heroId: string): string[] {
  const cls = getHero(heroId).cardClass;
  const classCards = collectibleCards()
    .filter((c) => c.cardClass === cls)
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  const deck = [...STARTER_CORE];
  for (const c of classCards) deck.push(c.id, c.id);
  return deck;
}
