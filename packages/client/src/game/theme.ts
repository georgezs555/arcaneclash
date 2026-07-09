// Card design system — flat stained-glass Tarot per REDESIGN_ROADMAP.md §1.
// Completely flat 2D: NO bevels, embossing, shadows or glows. The card's
// BORDER + lead lines change color by rarity (charcoal → indigo → amethyst →
// gold) so value reads at a glance; the watercolor panes shift pigment family
// to match. Consumed by the PixiJS board (numeric hex) and DOM (CSS strings).

import type { CardDef } from "@arcaneclash/engine";

export type RarityTier = "common" | "rare" | "epic" | "legendary";

export interface RarityTheme {
  /** Heavy outer border + lead lines — THE rarity signal. */
  line: number;
  /** Thin secondary keyline / Art Nouveau flourishes. */
  lineSoft: number;
  /** Flat fill for the cost cartouche + title ribbon. */
  accent: number;
  /** Base pigment the watercolor panes are washed over. */
  base: number;
  /** Soft, semi-translucent watercolor pane pigments (matte, washed). */
  wash: number[];
  /** Title / body ink. */
  ink: number;
  /** Flat hover border color (a clean shift, never a lift/shadow). */
  hover: number;
}

// Numeric (Pixi) palettes ---------------------------------------------------

export const THEMES: Record<RarityTier, RarityTheme> = {
  // COMMON — charcoal/black lead lines; muted earthy panes.
  common: {
    line: 0x171310,
    lineSoft: 0x4c4638,
    accent: 0x39413a,
    base: 0x2b332f,
    wash: [0x7c8a5f, 0x9aa0a6, 0xb39875, 0x7d92a8],
    ink: 0xf2ecdb,
    hover: 0xe6d9b4,
  },
  // RARE — deep indigo / dark-silver borders; jewel-tone panes.
  rare: {
    line: 0x232152,
    lineSoft: 0x8f96c0,
    accent: 0x2c2c66,
    base: 0x1b2048,
    wash: [0x2f5fb0, 0x7a4fb0, 0xd98fb0, 0x3f74c4],
    ink: 0xeef1ff,
    hover: 0xa8c0ff,
  },
  // EPIC — deep amethyst / silver borders; violet + rose panes.
  epic: {
    line: 0x3a2064,
    lineSoft: 0xbb96da,
    accent: 0x492f7c,
    base: 0x281a46,
    wash: [0x8a5ac0, 0xc06a9a, 0x6a5ac8, 0xd98fb0],
    ink: 0xf6ecff,
    hover: 0xdcb0ff,
  },
  // LEGENDARY — matte gold/amber border; blazing dramatic panes.
  legendary: {
    line: 0x9a6e1c,
    lineSoft: 0xe6c260,
    accent: 0x7a5716,
    base: 0x33240d,
    wash: [0xe6ad2e, 0xb23a48, 0xd8783a, 0xe6c454],
    ink: 0xfff3d2,
    hover: 0xffe28a,
  },
};

/** Map an engine rarity (5 tiers) onto a visual theme. */
export function tierOf(def: Pick<CardDef, "rarity">): RarityTier {
  switch (def.rarity) {
    case "legendary":
      return "legendary";
    case "epic":
      return "epic";
    case "rare":
      return "rare";
    default:
      return "common"; // basic + common + undefined
  }
}

export function themeOf(def: Pick<CardDef, "rarity">): RarityTheme {
  return THEMES[tierOf(def)];
}

// Neutral chrome — a dreamy dark-teal backdrop, muted so cards stay loudest.
export const CHROME = {
  bgBase: 0x12172a,
  bgWash: [0x213a5a, 0x2a2450, 0x1c3a46, 0x2b2340],
  bgGlow: 0x6f7db0,
  felt: 0x1a2038,
  feltEdge: 0x0e1224,
  rail: 0x6a6f8e,
  railSoft: 0x9aa0c4,
  ink: 0xf1e9d6,
  inkDim: 0xb9ad93,
  atkGem: 0xc07a1e,
  hpGem: 0xb0242f,
  costGem: 0x2f3f78,
};

// CSS string helpers --------------------------------------------------------

export const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;
export const rgba = (n: number, a: number): string =>
  `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;

// Shared card geometry (strict Tarot ratio 1 : 1.75) ------------------------

export const CARD = {
  ratio: 1.75,
  hand: { w: 178, h: Math.round(178 * 1.75) }, // 178 x 312
  minion: { w: 152, h: 190 },
  radius: 10,
};

// Roman numerals for the cost cartouche (0..10 → "0", I..X) ------------------

const ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
export function roman(n: number): string {
  if (n >= 0 && n <= 10) return ROMAN[n];
  return String(n);
}
