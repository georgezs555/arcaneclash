// Core type definitions for the ArcaneClash game engine.
// State is intentionally plain, serializable data (no functions / class instances)
// so it can be deep-cloned with structuredClone and sent over the wire for multiplayer.

export type PlayerIndex = 0 | 1;

export type CardType = "minion" | "spell";

export type CardClass =
  | "mage"
  | "warlock"
  | "paladin"
  | "warrior"
  | "priest"
  | "hunter"
  | "neutral";

/** A playable hero: a face, a class, and a hero power. */
export interface HeroDef {
  id: string;
  name: string;
  cardClass: Exclude<CardClass, "neutral">;
  heroPowerId: string;
}

// Keywords that live on a minion. `divineShield` is tracked separately as a
// consumable boolean on the instance, but we keep it in the keyword list too for display.
export type Keyword = "taunt" | "charge" | "rush" | "windfury" | "divineShield";

/** What a targeted effect (battlecry / spell / hero power) is allowed to hit. */
export interface TargetSpec {
  side: "any" | "enemy" | "friendly";
  kind: "character" | "minion"; // "character" = minions or heroes
}

/** A reference to something targetable in the current state. */
export type CharRef =
  | { kind: "hero"; player: PlayerIndex }
  | { kind: "minion"; instanceId: string };

/** Context handed to a card/hero-power effect when it resolves. */
export interface EffectContext {
  state: GameState;
  controller: PlayerIndex;
  /** The minion whose battlecry/deathrattle is firing; null for spells & hero powers. */
  source: CardInstance | null;
  /** The chosen target, if the effect required one. */
  target: CharRef | null;
  /** Deterministic RNG bound to game state. */
  rng: () => number;
}

export type Effect = (ctx: EffectContext) => void;

/** Static definition of a card. Lives in the registry, referenced by id. */
export interface CardDef {
  id: string;
  name: string;
  cost: number;
  type: CardType;
  text?: string;
  rarity?: "basic" | "common" | "rare" | "epic" | "legendary";
  /** Which class may put this card in a deck. Omitted = neutral. */
  cardClass?: CardClass;
  attack?: number;
  health?: number;
  keywords?: Keyword[];
  /** If set, the card must be given a target when played. */
  requiresTarget?: TargetSpec;
  /** Minion: fires when played from hand. */
  battlecry?: Effect;
  /** Minion: fires when it dies. */
  deathrattle?: Effect;
  /** Spell: fires when cast. */
  onCast?: Effect;
  /** Token minions are created by effects and don't belong in decks/collection. */
  token?: boolean;
}

export interface HeroPowerDef {
  id: string;
  name: string;
  cost: number;
  text: string;
  requiresTarget?: TargetSpec;
  effect: Effect;
}

/** A live instance of a card in a game (hand / deck / board). */
export interface CardInstance {
  instanceId: string;
  defId: string;
  owner: PlayerIndex;
  attack: number;
  health: number;
  maxHealth: number;
  keywords: Keyword[];
  divineShield: boolean;
  summonedThisTurn: boolean;
  attacksThisTurn: number;
  frozen: boolean;
}

export interface HeroState {
  health: number;
  maxHealth: number;
  armor: number;
  attack: number; // weapon attack, for later
}

export interface PlayerState {
  hero: HeroState;
  heroId: string;
  heroPowerId: string;
  heroPowerUsed: boolean;
  mana: number;
  maxMana: number;
  hand: CardInstance[];
  deck: CardInstance[];
  board: CardInstance[];
  fatigue: number;
}

export interface GameState {
  players: [PlayerState, PlayerState];
  active: PlayerIndex;
  turn: number;
  phase: "playing" | "gameover";
  winner: PlayerIndex | "draw" | null;
  rng: number; // current RNG state (32-bit)
  nextInstanceId: number;
  log: string[];
}

/** The moves a player can submit. */
export type Action =
  | { type: "END_TURN"; player: PlayerIndex }
  | {
      type: "PLAY_CARD";
      player: PlayerIndex;
      instanceId: string;
      target?: CharRef | null;
      position?: number;
    }
  | { type: "ATTACK"; player: PlayerIndex; attacker: string; target: CharRef }
  | { type: "HERO_POWER"; player: PlayerIndex; target?: CharRef | null };
