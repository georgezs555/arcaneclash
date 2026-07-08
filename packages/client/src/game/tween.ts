// Minimal tween system driven by the Pixi ticker. Tweens numeric properties
// directly on an object (position, alpha, scale-point, ...).

import type { Ticker } from "pixi.js";

export type Ease = (t: number) => number;

export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutQuad: Ease = (t) =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
export const linear: Ease = (t) => t;

interface Active {
  obj: Record<string, number>;
  from: Record<string, number>;
  to: Record<string, number>;
  elapsed: number;
  duration: number;
  ease: Ease;
  done?: () => void;
}

export class Tweens {
  private list: Active[] = [];

  constructor(ticker: Ticker) {
    ticker.add(() => this.tick(ticker.deltaMS));
  }

  /**
   * Tween `props` on `obj` over `duration` ms. Conflicting in-flight tweens on
   * the same object+property are cancelled (their `done` is not called).
   */
  to(
    obj: unknown,
    props: Record<string, number>,
    duration: number,
    ease: Ease = easeOutCubic,
    done?: () => void,
  ): void {
    const target = obj as Record<string, number>;
    for (const t of this.list) {
      if (t.obj !== target) continue;
      for (const k of Object.keys(props)) {
        delete t.from[k];
        delete t.to[k];
      }
    }
    this.list = this.list.filter((t) => Object.keys(t.to).length > 0);

    const from: Record<string, number> = {};
    for (const k of Object.keys(props)) from[k] = target[k];
    this.list.push({ obj: target, from, to: { ...props }, elapsed: 0, duration, ease, done });
  }

  private tick(deltaMS: number): void {
    const finished: Active[] = [];
    for (const t of this.list) {
      t.elapsed += deltaMS;
      const raw = Math.min(1, t.elapsed / t.duration);
      const k = t.ease(raw);
      try {
        for (const key of Object.keys(t.to)) {
          t.obj[key] = t.from[key] + (t.to[key] - t.from[key]) * k;
        }
      } catch {
        // Object was destroyed mid-tween; drop it.
        t.elapsed = t.duration;
        t.done = undefined;
      }
      if (raw >= 1) finished.push(t);
    }
    if (finished.length) {
      this.list = this.list.filter((t) => !finished.includes(t));
      for (const t of finished) t.done?.();
    }
  }
}
