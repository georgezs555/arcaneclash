// Procedural pixel-art card illustrations, full-card sized. Each card def
// gets deterministic art: a PRNG seeded from the def id paints a 48x64 pixel
// scene — dithered background, a mirrored shaded creature (minions) or a
// radiant sigil (spells) with a dark outline — uploaded as a nearest-neighbor
// texture so pixels stay crisp when stretched over the whole card.

import * as PIXI from "pixi.js";
import { getCardDef, type CardClass } from "@arcaneclash/engine";

const W = 48;
const H = 64;

interface Palette {
  bg: [number, number];
  body: number[]; // [mid, light, lighter, dark]
  glow: number;
}

const PALETTES: Record<CardClass, Palette> = {
  mage: {
    bg: [0x0a1526, 0x16294a],
    body: [0x3b82f6, 0x60a5fa, 0x93c5fd, 0x1e3a8a],
    glow: 0xe0f2fe,
  },
  warlock: {
    bg: [0x150925, 0x2b1245],
    body: [0x9333ea, 0xa855f7, 0xd8b4fe, 0x581c87],
    glow: 0xf0abfc,
  },
  paladin: {
    bg: [0x201806, 0x3a2d0e],
    body: [0xf59e0b, 0xfcd34d, 0xfde68a, 0x92400e],
    glow: 0xfef3c7,
  },
  warrior: {
    bg: [0x220a0a, 0x3d1515],
    body: [0xdc2626, 0xef4444, 0xfca5a5, 0x7f1d1d],
    glow: 0xfee2e2,
  },
  priest: {
    bg: [0x171e29, 0x2c3644],
    body: [0xcbd5e1, 0xe2e8f0, 0xf8fafc, 0x64748b],
    glow: 0xfde68a,
  },
  hunter: {
    bg: [0x0a1c11, 0x153a22],
    body: [0x22c55e, 0x4ade80, 0xbbf7d0, 0x15803d],
    glow: 0xdcfce7,
  },
  neutral: {
    bg: [0x171d28, 0x2a3040],
    body: [0xb08d57, 0xd6b98c, 0xe7d3b1, 0x6d5842],
    glow: 0xf5ead6,
  },
};

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function css(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

const OUTLINE = 0x0d1017;

const cache = new Map<string, PIXI.Texture>();

/** Call when the renderer that uploaded these textures is destroyed. */
export function clearArtCache(): void {
  cache.clear();
}

export function cardArtTexture(defId: string): PIXI.Texture {
  const cached = cache.get(defId);
  if (cached) return cached;

  const def = getCardDef(defId);
  const pal = PALETTES[def.cardClass ?? "neutral"];
  const rng = mulberry32(hashStr(defId));
  const isSpell = def.type === "spell";

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // --- background: vertical gradient with ordered dithering + sparkles ---
  for (let y = 0; y < H; y++) {
    const t = y / H;
    for (let x = 0; x < W; x++) {
      const dith = ((x + y) % 2) * 0.06;
      ctx.fillStyle = css(mix(pal.bg[0], pal.bg[1], Math.min(1, t + dith)));
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const sparkles = 14 + Math.floor(rng() * 14);
  for (let i = 0; i < sparkles; i++) {
    ctx.globalAlpha = 0.25 + rng() * 0.5;
    ctx.fillStyle = css(rng() < 0.4 ? pal.glow : pal.body[2]);
    ctx.fillRect(Math.floor(rng() * W), Math.floor(rng() * H), 1, 1);
  }
  ctx.globalAlpha = 1;

  // --- subject: build a mirrored cell grid, then paint with an outline ---
  const grid: (number | null)[] = new Array(W * H).fill(null);
  const at = (x: number, y: number) => grid[y * W + x];
  const set = (x: number, y: number, c: number) => {
    if (x >= 0 && x < W && y >= 0 && y < H) grid[y * W + x] = c;
  };

  const cx = W / 2;
  const cy = H * 0.52;
  const rx = W * (0.26 + rng() * 0.1);
  const ry = H * (0.24 + rng() * 0.08);

  for (let x = 0; x < Math.ceil(W / 2); x++) {
    for (let y = 0; y < H; y++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = isSpell
        ? Math.abs(dx) + Math.abs(dy) // diamond sigil
        : Math.sqrt(dx * dx + dy * dy); // rounded creature
      if (d > 1) continue;
      if (rng() > 0.96 - d * 0.42) continue;

      const vert = (y - (cy - ry)) / (2 * ry); // 0 top .. 1 bottom
      const r = rng();
      let color: number;
      if (d < 0.3 && r < 0.3) color = pal.glow;
      else if (vert < 0.35) color = r < 0.55 ? pal.body[1] : pal.body[2];
      else if (vert > 0.72) color = r < 0.6 ? pal.body[3] : pal.body[0];
      else color = r < 0.6 ? pal.body[0] : pal.body[1];
      set(x, y, color);
      set(W - 1 - x, y, color); // mirror
    }
  }

  if (isSpell) {
    // Radiating rays from the sigil.
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
    ];
    for (const [ux, uy] of dirs) {
      const len = ry * (1.1 + rng() * 0.5);
      for (let t = ry * 0.5; t < len; t++) {
        if (rng() < 0.35) continue;
        const px = Math.round(cx + ux * t * 0.9);
        const py = Math.round(cy + uy * t * 0.8);
        set(px, py, rng() < 0.5 ? pal.glow : pal.body[2]);
      }
    }
  } else {
    // Eyes: 2x2 sockets with a glow pupil, mirrored.
    const eyeY = Math.round(cy - ry * 0.28);
    const eyeX = Math.round(rx * 0.38);
    for (const sx of [cx - eyeX - 1, cx + eyeX - 1]) {
      const x0 = Math.round(sx);
      for (let dx2 = 0; dx2 < 2; dx2++)
        for (let dy2 = 0; dy2 < 2; dy2++) set(x0 + dx2, eyeY + dy2, OUTLINE);
      set(x0 + (rng() < 0.5 ? 0 : 1), eyeY, pal.glow);
    }
  }

  // Outline pass: subject cells touching empty space get a dark edge.
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const c = at(x, y);
      if (c === null || c === OUTLINE) continue;
      const edge =
        x === 0 || x === W - 1 || y === 0 || y === H - 1 ||
        at(x - 1, y) === null || at(x + 1, y) === null ||
        at(x, y - 1) === null || at(x, y + 1) === null;
      if (edge) grid[y * W + x] = OUTLINE;
    }
  }

  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      const c = at(x, y);
      if (c === null) continue;
      ctx.fillStyle = css(c);
      ctx.fillRect(x, y, 1, 1);
    }
  }

  const texture = PIXI.Texture.from(canvas, {
    scaleMode: PIXI.SCALE_MODES.NEAREST,
  });
  cache.set(defId, texture);
  return texture;
}
