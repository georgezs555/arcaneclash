// Card illustration loader. Drop an image named <cardDefId>.(png|jpg|webp)
// into packages/client/src/art/ and it becomes that card's full-bleed
// background automatically (Vite globs the folder at build time — restart the
// dev server after adding files). Cards without an image fall back to the
// procedural pixel art so the game always renders.
//
// Recommended source images: portrait orientation around 3:4 (e.g. 480x640);
// they are stretched to the card, so keep the subject centered.

import * as PIXI from "pixi.js";
import {
  cardArtTexture as pixelFallback,
  clearArtCache as clearPixelCache,
} from "./pixelart";

const urls = new Map<string, string>();
const modules = import.meta.glob("../art/*.{png,jpg,jpeg,webp}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
for (const [path, url] of Object.entries(modules)) {
  const base = path.split("/").pop()!.replace(/\.(png|jpe?g|webp)$/i, "");
  urls.set(base, url);
}

const cache = new Map<string, PIXI.Texture>();

export function cardArtTexture(defId: string): PIXI.Texture {
  const url = urls.get(defId);
  if (!url) return pixelFallback(defId);
  let texture = cache.get(defId);
  if (!texture || texture.baseTexture.destroyed) {
    texture = PIXI.Texture.from(url); // smooth (linear) scaling for painted art
    cache.set(defId, texture);
  }
  return texture;
}

/**
 * Hero portrait, from an image named hero_<heroId>.(png|jpg|webp) in the art
 * folder (e.g. hero_merlin.png). Returns null when no image exists — the
 * board then keeps its plain colored circle.
 */
export function heroArtTexture(heroId: string): PIXI.Texture | null {
  const key = `hero_${heroId}`;
  const url = urls.get(key);
  if (!url) return null;
  let texture = cache.get(key);
  if (!texture || texture.baseTexture.destroyed) {
    texture = PIXI.Texture.from(url);
    cache.set(key, texture);
  }
  return texture;
}

/** Call when the renderer that uploaded these textures is destroyed. */
export function clearArtCache(): void {
  cache.clear();
  clearPixelCache();
}

/** Card ids that have a real illustration (useful for tooling/debug). */
export function illustratedCards(): string[] {
  return [...urls.keys()];
}
