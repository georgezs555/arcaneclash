// Sound effects. Files live in public/sfx/<name>.mp3 and are served from /sfx.
// Playback clones the preloaded element so overlapping plays don't cut each
// other off; failures (e.g. autoplay restrictions before the first user
// gesture) are swallowed.

const MANIFEST = {
  attack_impact: 0.8,
  card_draw: 0.5,
  card_play_minion: 0.7,
  card_play_spell: 0.7,
  coin_flip: 0.7,
  deck_add_card: 0.5,
  deck_remove_card: 0.5,
  defeat_sting: 0.7,
  divine_shield_break: 0.7,
  end_turn_click: 0.6,
  freeze: 0.7,
  game_start_gong: 0.6,
  heal: 0.6,
  hero_damage: 0.7,
  hero_power_bargain: 0.7,
  hero_power_bulwark: 0.7,
  hero_power_flame: 0.7,
  hero_power_mend: 0.7,
  hero_power_rally: 0.7,
  hero_power_shot: 0.7,
  invalid_action: 0.5,
  match_found: 0.7,
  minion_death: 0.7,
  target_lock: 0.5,
  turn_start: 0.6,
  ui_click: 0.4,
  victory_fanfare: 0.8,
} as const;

export type SfxName = keyof typeof MANIFEST;

const MUTE_KEY = "arcaneclash.muted";
const cache = new Map<SfxName, HTMLAudioElement>();
let muted = false;

try {
  muted = localStorage.getItem(MUTE_KEY) === "1";
} catch {
  // storage unavailable; stay unmuted
}

function base(name: SfxName): HTMLAudioElement {
  let el = cache.get(name);
  if (!el) {
    el = new Audio(`/sfx/${name}.mp3`);
    el.preload = "auto";
    cache.set(name, el);
  }
  return el;
}

/** Warm the cache so first plays aren't delayed by network fetches. */
export function preloadSfx(): void {
  for (const name of Object.keys(MANIFEST) as SfxName[]) base(name);
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    // non-fatal
  }
}

export function playSfx(name: SfxName, delayMs = 0): void {
  if (muted) return;
  const fire = () => {
    if (muted) return;
    const node = base(name).cloneNode() as HTMLAudioElement;
    node.volume = MANIFEST[name];
    node.play().catch(() => {
      // Autoplay blocked before first gesture, or decode issue — ignore.
    });
  };
  if (delayMs > 0) setTimeout(fire, delayMs);
  else fire();
}
