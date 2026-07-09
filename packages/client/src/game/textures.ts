// Painterly texture generator. PixiJS Graphics can only flat-fill, so to get a
// soft "watercolor" look we paint onto an offscreen 2D canvas (real radial
// gradients, blooms, paper grain, vignette) and upload it as a PIXI.Texture.
// Every texture is cached by key and reused across all cards of that rarity.

import * as PIXI from "pixi.js";
import { hex, rgba } from "./theme";

const cache = new Map<string, PIXI.Texture>();

export function clearTextureCache(): void {
  for (const t of cache.values()) t.destroy(true);
  cache.clear();
}

function hash(s: string): number {
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

function make(
  key: string,
  w: number,
  h: number,
  paint: (ctx: CanvasRenderingContext2D, rng: () => number) => void,
): PIXI.Texture {
  const cached = cache.get(key);
  if (cached && !cached.baseTexture.destroyed) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  paint(ctx, mulberry32(hash(key)));
  const tex = PIXI.Texture.from(canvas); // linear scaling for smooth paint
  cache.set(key, tex);
  return tex;
}

/** Soft blooms of pigment over a base — the core watercolor wash. */
function paintWash(
  ctx: CanvasRenderingContext2D,
  rng: () => number,
  w: number,
  h: number,
  base: number,
  wash: number[],
  opts: { blooms?: number; light?: number } = {},
): void {
  ctx.fillStyle = hex(base);
  ctx.fillRect(0, 0, w, h);

  const blooms = opts.blooms ?? 20;
  for (let i = 0; i < blooms; i++) {
    const c = wash[Math.floor(rng() * wash.length)];
    const x = rng() * w;
    const y = rng() * h;
    const r = (0.22 + rng() * 0.42) * Math.max(w, h);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(c, 0.16 + rng() * 0.2));
    g.addColorStop(0.6, rgba(c, 0.05));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Upper light source (the luminous quality).
  const lg = ctx.createRadialGradient(w * 0.5, h * 0.26, 0, w * 0.5, h * 0.26, h * 0.7);
  lg.addColorStop(0, rgba(0xffffff, opts.light ?? 0.1));
  lg.addColorStop(1, rgba(0xffffff, 0));
  ctx.fillStyle = lg;
  ctx.fillRect(0, 0, w, h);

  // Paper grain.
  const grains = Math.floor(w * h * 0.03);
  for (let i = 0; i < grains; i++) {
    ctx.globalAlpha = rng() * 0.05;
    ctx.fillStyle = rng() < 0.5 ? "#000" : "#fff";
    ctx.fillRect(rng() * w, rng() * h, 1, 1);
  }
  ctx.globalAlpha = 1;

  // Vignette to sink the edges.
  const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.28, w / 2, h / 2, h * 0.66);
  v.addColorStop(0, rgba(0, 0));
  v.addColorStop(1, rgba(0x000000, 0.42));
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

/** A card-body watercolor texture for a rarity (cached, one per rarity). */
export function cardWashTexture(key: string, base: number, wash: number[]): PIXI.Texture {
  return make(`wash:${key}`, 220, 384, (ctx, rng) => paintWash(ctx, rng, 220, 384, base, wash));
}

/** A large full-bleed backdrop wash for the board environment. */
export function backdropTexture(
  w: number,
  h: number,
  base: number,
  wash: number[],
): PIXI.Texture {
  return make(`backdrop:${w}x${h}`, w, h, (ctx, rng) =>
    paintWash(ctx, rng, w, h, base, wash, { blooms: 34, light: 0.14 }),
  );
}

/** A soft radial halo (transparent edges) for glows behind art / heroes. */
export function haloTexture(color: number): PIXI.Texture {
  return make(`halo:${color}`, 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, rgba(color, 0.75));
    g.addColorStop(0.5, rgba(color, 0.28));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
}
