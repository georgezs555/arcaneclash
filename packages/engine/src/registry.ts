// Card definition registry. Cards register themselves here; mechanics & game logic
// look definitions up by id so that GameState only ever stores serializable data.

import type { CardDef, HeroDef, HeroPowerDef } from "./types";

const CARDS = new Map<string, CardDef>();
const HERO_POWERS = new Map<string, HeroPowerDef>();
const HEROES = new Map<string, HeroDef>();

export function registerCard(def: CardDef): CardDef {
  CARDS.set(def.id, def);
  return def;
}

export function registerHeroPower(def: HeroPowerDef): HeroPowerDef {
  HERO_POWERS.set(def.id, def);
  return def;
}

export function getCardDef(id: string): CardDef {
  const def = CARDS.get(id);
  if (!def) throw new Error(`Unknown card definition: ${id}`);
  return def;
}

export function getHeroPower(id: string): HeroPowerDef {
  const def = HERO_POWERS.get(id);
  if (!def) throw new Error(`Unknown hero power: ${id}`);
  return def;
}

export function allHeroPowers(): HeroPowerDef[] {
  return [...HERO_POWERS.values()];
}

export function hasHeroPower(id: string): boolean {
  return HERO_POWERS.has(id);
}

export function registerHero(def: HeroDef): HeroDef {
  HEROES.set(def.id, def);
  return def;
}

export function getHero(id: string): HeroDef {
  const def = HEROES.get(id);
  if (!def) throw new Error(`Unknown hero: ${id}`);
  return def;
}

export function hasHero(id: string): boolean {
  return HEROES.has(id);
}

export function allHeroes(): HeroDef[] {
  return [...HEROES.values()];
}

export function allCards(): CardDef[] {
  return [...CARDS.values()];
}

export function collectibleCards(): CardDef[] {
  return [...CARDS.values()].filter((c) => !c.token);
}
