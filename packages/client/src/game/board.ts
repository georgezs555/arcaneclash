// PixiJS board renderer. Draws the full game view (hands, boards, heroes,
// hero powers), animates transitions between engine states, and turns pointer
// input into engine Actions via the submit callback.

import * as PIXI from "pixi.js";
import {
  canAttack,
  getCardDef,
  getHeroPower,
  type Action,
  type CardDef,
  type CardInstance,
  type CharRef,
  type GameState,
  type PlayerIndex,
} from "@arcaneclash/engine";
import { Tweens, easeOutCubic, easeInOutQuad } from "./tween";
import { playSfx, type SfxName } from "./sfx";
import { cardArtTexture, clearArtCache, heroArtTexture } from "./cardart";
import {
  CARD,
  CHROME,
  roman,
  themeOf,
  tierOf,
  THEMES,
  type RarityTheme,
} from "./theme";
import {
  backdropTexture,
  cardWashTexture,
  clearTextureCache,
  haloTexture,
} from "./textures";

const HERO_POWER_SFX: Record<string, SfxName> = {
  hp_flame: "hero_power_flame",
  hp_bargain: "hero_power_bargain",
  hp_rally: "hero_power_rally",
  hp_bulwark: "hero_power_bulwark",
  hp_mend: "hero_power_mend",
  hp_shot: "hero_power_shot",
};

// Fallback size before the host has been measured (also the design reference).
export const VIEW_W = 1600;
export const VIEW_H = 1000;

const HAND = CARD.hand; // 176 x 308 — strict Tarot ratio
const MINION = CARD.minion; // 150 x 188 — compact board variant
const HERO_R = 54;

interface Metrics {
  topHand: number;
  topHero: number;
  topBoard: number;
  bottomBoard: number;
  bottomHero: number;
  bottomHand: number;
  divider: number;
  rowW: number;
  rowH: number;
}

/**
 * Responsive vertical layout derived from the live canvas size, so the board
 * fills the whole window at any resolution. Bands, top→bottom: opponent hand
 * (peeking), opponent hero, opponent board, [divider], my board, my hero, my
 * hand (fully visible at the bottom, above the hero — no overlap on the face).
 */
function computeMetrics(w: number, h: number): Metrics {
  // Player hand sits fully visible at the bottom; player hero sits just above
  // it (only its lower ~8px tucked behind the hand, face always visible).
  const bottomHand = h - HAND.h / 2 - 14;
  const handTop = bottomHand - HAND.h / 2;
  // Hero fully above the hand so its health gem stays visible.
  const bottomHero = handTop - HERO_R - 14;
  const heroTop = bottomHero - HERO_R;
  const bottomBoard = heroTop - 14 - MINION.h / 2;

  const topHero = Math.max(h * 0.1, HERO_R + 30);
  const topBoard = topHero + HERO_R + 14 + MINION.h / 2;

  return {
    topHand: -HAND.h * 0.34,
    topHero,
    topBoard,
    bottomBoard,
    bottomHero,
    bottomHand,
    divider: (topBoard + MINION.h / 2 + (bottomBoard - MINION.h / 2)) / 2,
    rowW: Math.min(w - 76, 1560),
    rowH: MINION.h + 22,
  };
}

const BUFF_COLOR = 0x86efac; // light green
const DEBUFF_COLOR = 0xfca5a5; // light red

// Flat, high-contrast typefaces. Serif for titles/numerals (the "elegant
// readable serif" from the brief); a clean sans for tiny stat glyphs.
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Segoe UI', system-ui, Arial, sans-serif";

// Opponent card-back palette: regal indigo watercolor, bright-gold medallion.
const BACK_THEME: RarityTheme = {
  ...THEMES.rare,
  line: 0xf3cd68,
  lineSoft: 0xfff2ca,
};

type Pending =
  | { kind: "play"; instanceId: string }
  | { kind: "attack"; attacker: string }
  | { kind: "heroPower" };

interface Slot {
  card: CardInstance;
  x: number;
  y: number;
  mode: "hand" | "board" | "back";
  zone: "hand" | "board";
  owner: PlayerIndex;
  canAct: boolean;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function label(
  str: string,
  size: number,
  fill: number,
  extra?: Partial<PIXI.ITextStyle>,
): PIXI.Text {
  const t = new PIXI.Text(str, {
    fontFamily: SANS,
    fontSize: size,
    fill,
    fontWeight: "600",
    align: "center",
    ...extra,
  });
  t.anchor.set(0.5);
  return t;
}

/** A serif title/numeral label — the elegant, high-contrast display face. */
function serifLabel(
  str: string,
  size: number,
  fill: number,
  extra?: Partial<PIXI.ITextStyle>,
): PIXI.Text {
  return label(str, size, fill, { fontFamily: SERIF, fontWeight: "700", ...extra });
}

function clearChildren(c: PIXI.Container): void {
  while (c.children.length > 0) {
    const child = c.children[0];
    // Sprites use shared cached art textures; everything else (Graphics,
    // Text) owns its texture and should release it.
    if (child instanceof PIXI.Sprite && !(child instanceof PIXI.Text)) {
      child.destroy({ children: true, texture: false, baseTexture: false });
    } else {
      child.destroy({ children: true, texture: true, baseTexture: true });
    }
  }
}

/** A metal-rimmed stat gem: solid disc, double keyline, serif value. */
function gem(
  x: number,
  y: number,
  color: number,
  value: string,
  r = 18,
  rim = 0xe4cf9a,
  textColor = 0xfff6e2,
): PIXI.Container {
  const wrap = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.beginFill(color);
  g.lineStyle({ width: 3, color: 0x140f0a, alpha: 0.9 });
  g.drawCircle(0, 0, r);
  g.endFill();
  g.lineStyle({ width: 1.5, color: rim, alpha: 0.95 });
  g.drawCircle(0, 0, r - 2);
  wrap.addChild(g, serifLabel(value, r + 1, textColor, { fontWeight: "700" }));
  wrap.position.set(x, y);
  return wrap;
}

// --- Flat stained-glass frame primitives -----------------------------------

/** Trace a gothic (pointed) arch: flat bottom, curved shoulders, apex on top. */
function archPath(
  g: PIXI.Graphics,
  left: number,
  right: number,
  top: number,
  bottom: number,
): void {
  const cx = (left + right) / 2;
  const spring = top + Math.min((right - left) * 0.5, (bottom - top) * 0.5);
  g.moveTo(left, bottom);
  g.lineTo(left, spring);
  g.quadraticCurveTo(left, top, cx, top);
  g.quadraticCurveTo(right, top, right, spring);
  g.lineTo(right, bottom);
  g.lineTo(left, bottom);
}

/** A rounded-rect mask sized to a card, for clipping the watercolor sprite. */
function roundedMask(w: number, h: number): PIXI.Graphics {
  const m = new PIXI.Graphics();
  m.beginFill(0xffffff);
  m.drawRoundedRect(-w / 2, -h / 2, w, h, CARD.radius);
  m.endFill();
  return m;
}

/** The gilded double frame (Art Nouveau metal) with jewelled corner studs. */
function metalFrame(node: PIXI.Container, w: number, h: number, theme: RarityTheme): void {
  const f = new PIXI.Graphics();
  f.lineStyle({ width: 3, color: theme.line, alpha: 1 });
  f.drawRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, CARD.radius - 2);
  f.lineStyle({ width: 1, color: theme.lineSoft, alpha: 0.8 });
  f.drawRoundedRect(-w / 2 + 6.5, -h / 2 + 6.5, w - 13, h - 13, CARD.radius - 4);
  f.lineStyle();
  f.beginFill(theme.lineSoft, 0.95);
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) f.drawCircle(sx * (w / 2 - 9), sy * (h / 2 - 9), 2.6);
  f.endFill();
  node.addChild(f);
}

/**
 * The painterly card body: a soft watercolor wash (canvas texture) clipped to
 * the card, a luminous gothic-arch art window, and a gilded frame. Callers add
 * the cost gem, title plate, rules panel and stat gems on top.
 */
function cardChrome(
  node: PIXI.Container,
  defId: string,
  def: CardDef,
  w: number,
  h: number,
  statusBorder: number,
  statusWidth: number,
  artBottomY: number,
): void {
  const theme = themeOf(def);

  // Watercolor wash, clipped to the rounded card.
  const bg = new PIXI.Sprite(cardWashTexture(tierOf(def), theme.base, theme.wash));
  bg.width = w;
  bg.height = h;
  bg.position.set(-w / 2, -h / 2);
  const mask = roundedMask(w, h);
  bg.mask = mask;
  node.addChild(bg, mask);

  // Gothic-arch art window.
  const inset = 14;
  const ax = -w / 2 + inset;
  const aRight = w / 2 - inset;
  const ay = -h / 2 + inset;
  const acx = (ax + aRight) / 2;
  const acy = (ay + artBottomY) / 2;

  // Warm halo behind the art for luminosity.
  const halo = new PIXI.Sprite(haloTexture(theme.hover));
  halo.anchor.set(0.5);
  halo.width = (aRight - ax) * 1.25;
  halo.height = (artBottomY - ay) * 1.25;
  halo.position.set(acx, acy);
  halo.alpha = 0.45;
  node.addChild(halo);

  const artMask = new PIXI.Graphics();
  artMask.beginFill(0xffffff);
  archPath(artMask, ax, aRight, ay, artBottomY);
  artMask.endFill();
  const art = new PIXI.Sprite(cardArtTexture(defId));
  art.position.set(ax, ay);
  art.width = aRight - ax;
  art.height = artBottomY - ay;
  art.mask = artMask;
  node.addChild(art, artMask);

  // Gilded arch keyline.
  const arch = new PIXI.Graphics();
  arch.lineStyle({ width: 2.5, color: theme.line, alpha: 1 });
  archPath(arch, ax, aRight, ay, artBottomY);
  arch.lineStyle({ width: 1, color: theme.lineSoft, alpha: 0.7 });
  archPath(arch, ax + 2, aRight - 2, ay + 2, artBottomY);
  node.addChild(arch);

  metalFrame(node, w, h, theme);

  // Status ring hugging the card edge (selected / actable / taunt).
  if (statusWidth > 0) {
    const ring = new PIXI.Graphics();
    ring.lineStyle({ width: statusWidth, color: statusBorder, alpha: 1 });
    ring.drawRoundedRect(
      -w / 2 + statusWidth / 2,
      -h / 2 + statusWidth / 2,
      w - statusWidth,
      h - statusWidth,
      CARD.radius,
    );
    node.addChild(ring);
  }
}

/** A slim gilded name plate with a serif title. */
function titlePlate(
  name: string,
  w: number,
  cy: number,
  theme: RarityTheme,
  fontSize: number,
): PIXI.Container {
  const wrap = new PIXI.Container();
  const rw = w - 14;
  const rh = fontSize + 12;
  const g = new PIXI.Graphics();
  g.beginFill(0x120d09, 0.74);
  g.drawRoundedRect(-rw / 2, -rh / 2, rw, rh, rh / 2);
  g.endFill();
  g.lineStyle({ width: 1.5, color: theme.line, alpha: 0.95 });
  g.drawRoundedRect(-rw / 2, -rh / 2, rw, rh, rh / 2);
  wrap.addChild(
    g,
    serifLabel(name, fontSize, theme.ink, { wordWrap: true, wordWrapWidth: rw - 18 }),
  );
  wrap.position.set(0, cy);
  return wrap;
}

/** A dark, legible rules panel bordered in metal. */
function rulesPanel(w: number, top: number, bottom: number, theme: RarityTheme): PIXI.Graphics {
  const g = new PIXI.Graphics();
  g.beginFill(0x0f0b08, 0.82);
  g.drawRoundedRect(-w / 2 + 11, top, w - 22, bottom - top, 7);
  g.endFill();
  g.lineStyle({ width: 1, color: theme.line, alpha: 0.55 });
  g.drawRoundedRect(-w / 2 + 11, top, w - 22, bottom - top, 7);
  return g;
}

function drawHandCard(
  node: PIXI.Container,
  card: CardInstance,
  def: CardDef,
  canAct: boolean,
  selected: boolean,
): void {
  const { w, h } = HAND;
  const theme = themeOf(def);
  const [border, bw] = selected
    ? [0xffe08a, 5]
    : canAct
      ? [0x86efac, 4]
      : [0, 0];

  const plateCY = -h / 2 + h * 0.6;
  const artBottomY = plateCY - 22;
  cardChrome(node, card.defId, def, w, h, border, bw, artBottomY);

  // Cost gem, top-left, overlapping the frame.
  node.addChild(gem(-w / 2 + 21, -h / 2 + 21, theme.accent, roman(def.cost), 19, theme.lineSoft));

  // Name plate.
  node.addChild(titlePlate(def.name, w, plateCY, theme, 15));

  // Rules panel with legible serif text.
  const boxTop = plateCY + (15 + 12) / 2 + 3;
  const boxBottom = h / 2 - 12;
  node.addChild(rulesPanel(w, boxTop, boxBottom, theme));

  if (def.text) {
    const text = label(def.text, 12.5, 0xf1ead9, {
      fontFamily: SERIF,
      wordWrap: true,
      wordWrapWidth: w - 42,
      fontWeight: "400",
    });
    text.position.set(0, (boxTop + boxBottom) / 2);
    node.addChild(text);
  } else if (def.type === "minion") {
    const kw = def.keywords?.join(" · ");
    if (kw) {
      const t = serifLabel(kw, 13, theme.lineSoft, { fontWeight: "600" });
      t.position.set(0, (boxTop + boxBottom) / 2);
      node.addChild(t);
    }
  }

  if (def.type === "minion") {
    node.addChild(gem(-w / 2 + 21, h / 2 - 21, CHROME.atkGem, String(card.attack), 20));
    node.addChild(gem(w / 2 - 21, h / 2 - 21, CHROME.hpGem, String(card.health), 20));
  }
}

function drawMinion(
  node: PIXI.Container,
  card: CardInstance,
  def: CardDef,
  canAct: boolean,
  selected: boolean,
): void {
  const { w, h } = MINION;
  const theme = themeOf(def);
  const taunt = card.keywords.includes("taunt");
  const [border, bw] = selected
    ? [0xffe08a, 5]
    : canAct
      ? [0x86efac, 4]
      : taunt
        ? [0xcbb389, 5]
        : [0, 0];

  const plateCY = -h / 2 + h * 0.85;
  const artBottomY = plateCY - 14;
  cardChrome(node, card.defId, def, w, h, border, bw, artBottomY);

  node.addChild(titlePlate(def.name, w, plateCY, theme, 12.5));

  const kw = card.keywords.filter((k) => k !== "divineShield").join(" · ");
  if (kw) {
    const t = serifLabel(kw, 10.5, theme.lineSoft, { fontWeight: "600" });
    t.position.set(0, plateCY + 17);
    node.addChild(t);
  }

  // Divine shield: a bright gold keyline just inside the frame.
  if (card.divineShield) {
    const ds = new PIXI.Graphics();
    ds.lineStyle({ width: 3, color: 0xffe08a, alpha: 1 });
    ds.drawRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, CARD.radius - 2);
    node.addChild(ds);
  }

  // Stat gems tint when modified from the printed values.
  const baseAtk = def.attack ?? 0;
  const atkColor =
    card.attack > baseAtk ? BUFF_COLOR : card.attack < baseAtk ? DEBUFF_COLOR : 0xfff6e2;
  node.addChild(gem(-w / 2 + 19, h / 2 - 19, CHROME.atkGem, String(card.attack), 18, 0xe4cf9a, atkColor));

  const hpColor =
    card.health < card.maxHealth
      ? DEBUFF_COLOR
      : card.maxHealth > (def.health ?? 0)
        ? BUFF_COLOR
        : 0xfff6e2;
  node.addChild(gem(w / 2 - 19, h / 2 - 19, CHROME.hpGem, String(card.health), 18, 0xe4cf9a, hpColor));

  // Frozen: a pale-blue wash over the card + a rune.
  if (card.frozen) {
    const ice = new PIXI.Graphics();
    ice.beginFill(0x7dd3fc, 0.28);
    ice.drawRoundedRect(-w / 2, -h / 2, w, h, CARD.radius);
    ice.endFill();
    ice.lineStyle({ width: 2, color: 0xbae6fd, alpha: 0.95 });
    ice.drawRoundedRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, CARD.radius - 2);
    node.addChild(ice);
    const t = label("❄", 24, 0xe0f2fe);
    t.position.set(0, -h / 2 + 30);
    node.addChild(t);
  }
}

function drawCardBack(node: PIXI.Container): void {
  const { w, h } = HAND;
  const theme = BACK_THEME;

  const bg = new PIXI.Sprite(cardWashTexture("back", theme.base, theme.wash));
  bg.width = w;
  bg.height = h;
  bg.position.set(-w / 2, -h / 2);
  const mask = roundedMask(w, h);
  bg.mask = mask;
  node.addChild(bg, mask);

  // Gilded rose-window medallion.
  const rose = new PIXI.Graphics();
  rose.lineStyle({ width: 2.5, color: theme.line, alpha: 0.95 });
  rose.drawCircle(0, 0, 54);
  rose.drawCircle(0, 0, 32);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    rose.moveTo(Math.cos(a) * 32, Math.sin(a) * 32);
    rose.lineTo(Math.cos(a) * 54, Math.sin(a) * 54);
  }
  rose.lineStyle({ width: 1.5, color: theme.lineSoft, alpha: 0.85 });
  rose.drawCircle(0, 0, 14);
  node.addChild(rose);

  metalFrame(node, w, h, theme);
}

// ---------------------------------------------------------------------------
// Card node
// ---------------------------------------------------------------------------

class CardNode extends PIXI.Container {
  readonly id: string;
  zone: "hand" | "board" = "hand";

  constructor(
    id: string,
    onTap: (id: string) => void,
    onHover: (id: string, over: boolean) => void,
  ) {
    super();
    this.id = id;
    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointertap", (e: PIXI.FederatedPointerEvent) => {
      e.stopPropagation();
      onTap(this.id);
    });
    this.on("pointerover", () => onHover(this.id, true));
    this.on("pointerout", () => onHover(this.id, false));
  }

  redraw(slot: Slot, selected: boolean): void {
    clearChildren(this);
    const def = getCardDef(slot.card.defId);
    if (slot.mode === "back") drawCardBack(this);
    else if (slot.mode === "hand") drawHandCard(this, slot.card, def, slot.canAct, selected);
    else drawMinion(this, slot.card, def, slot.canAct, selected);
  }
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export class Board {
  readonly app: PIXI.Application;
  private tweens: Tweens;
  private nodes = new Map<string, CardNode>();
  private heroNodes: PIXI.Container[] = [];
  private powerNodes: PIXI.Container[] = [];
  private cardLayer = new PIXI.Container();
  private arrow = new PIXI.Graphics();
  private fxLayer = new PIXI.Container();
  private pending: Pending | null = null;
  private pendingOrigin: { x: number; y: number } | null = null;
  private state: GameState | null = null;
  private lastSlots = new Map<string, Slot>();
  private statusPanel: PIXI.Container | null = null;
  private hoveredId: string | null = null;
  private bottom: PlayerIndex = 0;
  private submit: (a: Action) => string | null;
  private seatNames: [string, string];
  private w = VIEW_W;
  private h = VIEW_H;
  private m: Metrics = computeMetrics(VIEW_W, VIEW_H);
  private envNode: PIXI.Container | null = null;
  private resizeObserver: ResizeObserver;

  constructor(
    parent: HTMLElement,
    submit: (a: Action) => string | null,
    seatNames: [string, string],
  ) {
    this.submit = submit;
    this.seatNames = seatNames;
    this.w = Math.max(640, Math.round(parent.clientWidth) || VIEW_W);
    this.h = Math.max(480, Math.round(parent.clientHeight) || VIEW_H);
    this.m = computeMetrics(this.w, this.h);
    this.app = new PIXI.Application({
      width: this.w,
      height: this.h,
      backgroundColor: CHROME.bgBase,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    const view = this.app.view as HTMLCanvasElement;
    // Fill the host 1:1 — the renderer itself is resized to the host, so the
    // board fills the whole window at any resolution (no letterbox bars).
    view.style.width = "100%";
    view.style.height = "100%";
    view.style.display = "block";
    view.addEventListener("contextmenu", (e) => e.preventDefault());
    parent.appendChild(view);

    this.tweens = new Tweens(this.app.ticker);

    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = new PIXI.Rectangle(0, 0, this.w, this.h);
    stage.sortableChildren = true;

    this.envNode = this.buildEnvironment();
    stage.addChild(this.envNode);

    this.cardLayer.zIndex = 10;
    this.cardLayer.sortableChildren = true;
    stage.addChild(this.cardLayer);

    this.arrow.zIndex = 50;
    this.arrow.eventMode = "none";
    stage.addChild(this.arrow);

    this.fxLayer.zIndex = 100;
    this.fxLayer.eventMode = "none";
    stage.addChild(this.fxLayer);

    for (const p of [0, 1] as const) {
      const hero = new PIXI.Container();
      hero.zIndex = 5;
      hero.eventMode = "static";
      hero.cursor = "pointer";
      hero.on("pointertap", (e: PIXI.FederatedPointerEvent) => {
        e.stopPropagation();
        this.onHeroTap(p);
      });
      this.heroNodes.push(hero);
      stage.addChild(hero);

      const power = new PIXI.Container();
      power.zIndex = 5;
      power.eventMode = "static";
      power.cursor = "pointer";
      power.on("pointertap", (e: PIXI.FederatedPointerEvent) => {
        e.stopPropagation();
        this.onHeroPowerTap(p);
      });
      this.powerNodes.push(power);
      stage.addChild(power);
    }

    stage.on("pointermove", (e: PIXI.FederatedPointerEvent) => {
      if (this.pending) this.drawArrow(e.global.x, e.global.y);
    });
    stage.on("pointertap", () => this.clearPending());
    stage.on("rightdown", () => this.clearPending());

    // Keep the renderer sized to its host so the board always fills the window.
    this.resizeObserver = new ResizeObserver(() => {
      const cw = Math.max(640, Math.round(parent.clientWidth));
      const ch = Math.max(480, Math.round(parent.clientHeight));
      if (cw !== this.w || ch !== this.h) this.resize(cw, ch);
    });
    this.resizeObserver.observe(parent);
  }

  /** Re-fit the renderer and re-lay-out for a new host size. */
  private resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.m = computeMetrics(w, h);
    this.app.renderer.resize(w, h);
    this.app.stage.hitArea = new PIXI.Rectangle(0, 0, w, h);
    if (this.envNode) {
      this.envNode.destroy({ children: true });
      this.envNode = this.buildEnvironment();
      this.app.stage.addChild(this.envNode);
    }
    if (this.state) this.applyState(null, this.state);
  }

  /** Dreamy watercolor backdrop with two luminous board rows + gilded divider. */
  private buildEnvironment(): PIXI.Container {
    const c = new PIXI.Container();
    c.zIndex = 0;
    c.eventMode = "none";
    const midX = this.w / 2;
    const { rowW, rowH } = this.m;

    // Full-bleed painterly backdrop.
    const back = new PIXI.Sprite(
      backdropTexture(this.w, this.h, CHROME.bgBase, CHROME.bgWash),
    );
    back.width = this.w;
    back.height = this.h;
    c.addChild(back);

    const g = new PIXI.Graphics();
    // Two board rows: soft, luminous, gilded rims.
    for (const cy of [this.m.topBoard, this.m.bottomBoard]) {
      g.beginFill(CHROME.felt, 0.5);
      g.drawRoundedRect(midX - rowW / 2, cy - rowH / 2, rowW, rowH, 22);
      g.endFill();
      g.lineStyle({ width: 2, color: CHROME.rail, alpha: 0.55 });
      g.drawRoundedRect(midX - rowW / 2, cy - rowH / 2, rowW, rowH, 22);
      g.lineStyle({ width: 1, color: CHROME.railSoft, alpha: 0.3 });
      g.drawRoundedRect(midX - rowW / 2 + 4, cy - rowH / 2 + 4, rowW - 8, rowH - 8, 20);
      g.lineStyle();
    }

    // Center divider with a gilded diamond ornament between the two rows.
    const dy = this.m.divider;
    g.lineStyle({ width: 1.5, color: CHROME.rail, alpha: 0.7 });
    g.moveTo(midX - rowW / 2 + 40, dy);
    g.lineTo(midX - 78, dy);
    g.moveTo(midX + 78, dy);
    g.lineTo(midX + rowW / 2 - 40, dy);
    g.lineStyle({ width: 2, color: CHROME.railSoft, alpha: 0.95 });
    g.beginFill(CHROME.rail, 0.5);
    g.moveTo(midX, dy - 28);
    g.lineTo(midX + 48, dy);
    g.lineTo(midX, dy + 28);
    g.lineTo(midX - 48, dy);
    g.lineTo(midX, dy - 28);
    g.endFill();
    c.addChild(g);
    return c;
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.app.destroy(true, { children: true, texture: true, baseTexture: true });
    // The destroy above tears down the shared art textures with the stage.
    clearArtCache();
    clearTextureCache();
  }

  // -------------------------------------------------------------------------
  // State application
  // -------------------------------------------------------------------------

  update(state: GameState, action: Action | undefined, bottom: PlayerIndex): void {
    const prev = this.state;
    this.state = state;
    this.bottom = bottom;
    this.clearPending(false);
    this.playActionSounds(prev, state, action);

    // Attack lunge: animate the attacker into the target before re-laying out.
    if (action?.type === "ATTACK" && prev) {
      const node = this.nodes.get(action.attacker);
      const targetPos = this.positionOf(action.target);
      if (node && targetPos) {
        node.zIndex = 40;
        const dx = node.x + (targetPos.x - node.x) * 0.82;
        const dy = node.y + (targetPos.y - node.y) * 0.82;
        this.tweens.to(node, { x: dx, y: dy }, 160, easeInOutQuad, () => {
          playSfx("attack_impact");
          this.applyState(prev, state);
        });
        return;
      }
    }
    if (action?.type === "ATTACK") playSfx("attack_impact");
    this.applyState(prev, state);
  }

  private playActionSounds(
    prev: GameState | null,
    state: GameState,
    action: Action | undefined,
  ): void {
    if (prev?.phase === "mulligan" && state.phase === "playing") {
      playSfx("game_start_gong");
    }
    if (!action) return;
    switch (action.type) {
      case "PLAY_CARD": {
        // The played card is gone from hand; find its def via the log-free
        // route: it lived in prev's hand.
        const owner = prev?.players[action.player];
        const card = owner?.hand.find((c) => c.instanceId === action.instanceId);
        if (!card) break;
        const def = getCardDef(card.defId);
        if (card.defId === "coin") playSfx("coin_flip");
        else playSfx(def.type === "minion" ? "card_play_minion" : "card_play_spell");
        break;
      }
      case "HERO_POWER": {
        const hpId = state.players[action.player].heroPowerId;
        const sfx = HERO_POWER_SFX[hpId];
        if (sfx) playSfx(sfx);
        break;
      }
      case "END_TURN":
        // Chime only when the turn comes to the bottom seat (yours).
        if (state.phase === "playing" && state.active === this.bottom) {
          playSfx("turn_start");
        }
        break;
      case "MULLIGAN":
        playSfx("card_draw");
        break;
      case "ATTACK":
        break; // handled with the lunge
    }
  }

  private applyState(prev: GameState | null, state: GameState): void {
    const slots = this.computeLayout(state);
    this.lastSlots = slots;

    for (const [id, node] of [...this.nodes]) {
      if (!slots.has(id)) {
        this.nodes.delete(id);
        if (this.hoveredId === id) {
          this.hoveredId = null;
          this.hideStatusPanel();
        }
        node.eventMode = "none";
        this.tweens.to(node, { alpha: 0 }, 300, easeOutCubic, () => {
          node.destroy({ children: true });
        });
      }
    }

    // Stat values may have changed under the cursor; drop the stale panel.
    this.hideStatusPanel();

    for (const [id, slot] of slots) {
      let node = this.nodes.get(id);
      if (!node) {
        node = new CardNode(
          id,
          (nid) => this.onCardTap(nid),
          (nid, over) => this.onHover(nid, over),
        );
        this.nodes.set(id, node);
        this.cardLayer.addChild(node);
        if (slot.zone === "hand") {
          node.position.set(this.w - 50, slot.y); // drawn from the deck
        } else {
          node.position.set(slot.x, slot.y); // summoned token: pop in
          node.scale.set(0.2);
          this.tweens.to(node.scale, { x: 1, y: 1 }, 240);
        }
      }
      node.zone = slot.zone;
      node.zIndex = slot.zone === "hand" ? 20 : 10;
      const selected =
        (this.pending?.kind === "play" && this.pending.instanceId === id) ||
        (this.pending?.kind === "attack" && this.pending.attacker === id);
      node.redraw(slot, selected);
      this.tweens.to(node, { x: slot.x, y: slot.y }, 260);
    }

    for (const p of [0, 1] as const) {
      const isBottom = p === this.bottom;
      const heroY = isBottom ? this.m.bottomHero : this.m.topHero;
      this.redrawHero(p, state);
      this.redrawHeroPower(p, state);
      this.tweens.to(this.heroNodes[p], { x: this.w / 2, y: heroY }, 260);
      this.tweens.to(this.powerNodes[p], { x: this.w / 2 + 132, y: heroY }, 260);
    }

    if (prev) this.spawnCombatFloats(prev, state, slots);
  }

  private computeLayout(state: GameState): Map<string, Slot> {
    const slots = new Map<string, Slot>();
    for (const p of [0, 1] as const) {
      const pl = state.players[p];
      const isBottom = p === this.bottom;
      const myTurn = state.active === p && state.phase === "playing";

      const handY = isBottom ? this.m.bottomHand : this.m.topHand;
      const n = pl.hand.length;
      const spacing = Math.min(HAND.w + 6, (this.w * 0.9) / Math.max(n, 1));
      const x0 = this.w / 2 - ((n - 1) * spacing) / 2;
      pl.hand.forEach((card, i) => {
        const def = getCardDef(card.defId);
        const affordable =
          def.cost <= pl.mana &&
          (def.type === "spell" || pl.board.length < 7);
        slots.set(card.instanceId, {
          card,
          x: x0 + i * spacing,
          y: handY,
          mode: isBottom ? "hand" : "back",
          zone: "hand",
          owner: p,
          canAct: isBottom && myTurn && affordable,
        });
      });

      const boardY = isBottom ? this.m.bottomBoard : this.m.topBoard;
      const bn = pl.board.length;
      const bSpacing = MINION.w + 16;
      const bx0 = this.w / 2 - ((bn - 1) * bSpacing) / 2;
      pl.board.forEach((card, i) => {
        slots.set(card.instanceId, {
          card,
          x: bx0 + i * bSpacing,
          y: boardY,
          mode: "board",
          zone: "board",
          owner: p,
          canAct: isBottom && myTurn && canAttack(state, card),
        });
      });
    }
    return slots;
  }

  private redrawHero(p: PlayerIndex, state: GameState): void {
    const node = this.heroNodes[p];
    clearChildren(node);
    const hero = state.players[p].hero;
    const R = 56;
    const active = state.active === p && state.phase === "playing";

    // Soft halo when it's this hero's turn.
    if (active) {
      const glow = new PIXI.Sprite(haloTexture(CHROME.railSoft));
      glow.anchor.set(0.5);
      glow.width = glow.height = (R + 22) * 2;
      glow.alpha = 0.5;
      node.addChild(glow);
    }

    const g = new PIXI.Graphics();
    g.lineStyle({ width: 4, color: 0x140f0a });
    g.beginFill(p === this.bottom ? 0x233150 : 0x3a2436);
    g.drawCircle(0, 0, R);
    g.endFill();
    node.addChild(g);

    // Hero portrait clipped to the circle, when an image exists.
    const portrait = heroArtTexture(state.players[p].heroId);
    if (portrait) {
      const sprite = new PIXI.Sprite(portrait);
      const d = (R - 2) * 2;
      sprite.width = d;
      sprite.height = d;
      sprite.position.set(-d / 2, -d / 2);
      const mask = new PIXI.Graphics();
      mask.beginFill(0xffffff);
      mask.drawCircle(0, 0, R - 2);
      mask.endFill();
      sprite.mask = mask;
      node.addChild(sprite, mask);
    }

    // Gilded double ring around the portrait.
    const ring = new PIXI.Graphics();
    ring.lineStyle({ width: 4, color: active ? CHROME.railSoft : CHROME.rail, alpha: 1 });
    ring.drawCircle(0, 0, R);
    ring.lineStyle({ width: 1.5, color: 0x140f0a, alpha: 0.7 });
    ring.drawCircle(0, 0, R - 3);
    node.addChild(ring);

    // Health / armor gems on the ring.
    node.addChild(gem(R - 8, R - 8, CHROME.hpGem, String(hero.health), 18));
    if (hero.armor > 0) node.addChild(gem(-(R - 8), R - 8, 0x8b93a3, String(hero.armor), 15));

    // Name plate below the portrait (kept clear of the gems).
    const nm = this.seatNames[p];
    const plateW = Math.max(84, nm.length * 8 + 20);
    const plate = new PIXI.Graphics();
    plate.beginFill(0x120d09, 0.82);
    plate.drawRoundedRect(-plateW / 2, R + 4, plateW, 22, 11);
    plate.endFill();
    plate.lineStyle({ width: 1.5, color: CHROME.rail, alpha: 0.9 });
    plate.drawRoundedRect(-plateW / 2, R + 4, plateW, 22, 11);
    node.addChild(plate);
    const name = serifLabel(nm, 13, CHROME.ink, { fontWeight: "600" });
    name.position.set(0, R + 15);
    node.addChild(name);

    if (state.phase === "gameover") node.alpha = state.winner === p ? 1 : 0.4;
  }

  private redrawHeroPower(p: PlayerIndex, state: GameState): void {
    const node = this.powerNodes[p];
    clearChildren(node);
    const pl = state.players[p];
    const hp = getHeroPower(pl.heroPowerId);
    const usable =
      p === this.bottom &&
      state.active === p &&
      state.phase === "playing" &&
      !pl.heroPowerUsed &&
      hp.cost <= pl.mana;
    const g = new PIXI.Graphics();
    g.beginFill(pl.heroPowerUsed ? 0x2b2740 : 0x4a3a72);
    g.lineStyle({ width: 4, color: usable ? 0x86efac : 0x140f0a, alpha: 0.95 });
    g.drawCircle(0, 0, 30);
    g.endFill();
    g.lineStyle({ width: 1.5, color: CHROME.railSoft, alpha: 0.8 });
    g.drawCircle(0, 0, 27);
    node.addChild(g);
    const initials = hp.name.split(" ").map((w) => w[0] ?? "").join("");
    node.addChild(serifLabel(initials, 16, 0xf3eee0, { fontWeight: "700" }));
    node.addChild(gem(0, -30, CHROME.costGem, roman(hp.cost), 12));
    node.alpha = pl.heroPowerUsed ? 0.55 : 1;
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private onCardTap(id: string): void {
    const state = this.state;
    if (!state || state.phase !== "playing") return;
    const found = locate(state, id);
    if (!found) return;
    const { card, owner, zone } = found;
    const bottom = this.bottom;

    if (this.pending) {
      if (zone === "board") {
        this.commitTarget({ kind: "minion", instanceId: id });
      } else {
        this.clearPending();
      }
      return;
    }

    if (owner !== bottom || state.active !== bottom) return;

    if (zone === "hand") {
      const def = getCardDef(card.defId);
      if (def.cost > state.players[bottom].mana) {
        this.toast("Not enough mana");
        return;
      }
      if (def.requiresTarget) {
        this.setPending({ kind: "play", instanceId: id });
      } else {
        const err = this.submit({
          type: "PLAY_CARD",
          player: bottom,
          instanceId: id,
        });
        if (err) this.toast(err);
      }
    } else {
      if (canAttack(state, card)) {
        this.setPending({ kind: "attack", attacker: id });
      } else {
        this.toast("That minion can't attack right now");
      }
    }
  }

  private onHeroTap(p: PlayerIndex): void {
    if (this.pending) this.commitTarget({ kind: "hero", player: p });
  }

  private onHeroPowerTap(p: PlayerIndex): void {
    const state = this.state;
    if (!state || state.phase !== "playing") return;
    if (this.pending) {
      this.clearPending();
      return;
    }
    if (p !== this.bottom || state.active !== this.bottom) return;
    const pl = state.players[p];
    const hp = getHeroPower(pl.heroPowerId);
    if (pl.heroPowerUsed) return this.toast("Hero power already used");
    if (hp.cost > pl.mana) return this.toast("Not enough mana");
    if (hp.requiresTarget) {
      this.setPending({ kind: "heroPower" });
    } else {
      const err = this.submit({ type: "HERO_POWER", player: p });
      if (err) this.toast(err);
    }
  }

  private commitTarget(ref: CharRef): void {
    const pending = this.pending;
    if (!pending) return;
    const p = this.bottom;
    let action: Action;
    if (pending.kind === "play") {
      action = { type: "PLAY_CARD", player: p, instanceId: pending.instanceId, target: ref };
    } else if (pending.kind === "attack") {
      action = { type: "ATTACK", player: p, attacker: pending.attacker, target: ref };
    } else {
      action = { type: "HERO_POWER", player: p, target: ref };
    }
    this.clearPending();
    const err = this.submit(action);
    if (err) this.toast(err);
  }

  private setPending(pending: Pending): void {
    playSfx("target_lock");
    this.pending = pending;
    let node: PIXI.Container | undefined;
    if (pending.kind === "play") node = this.nodes.get(pending.instanceId);
    else if (pending.kind === "attack") node = this.nodes.get(pending.attacker);
    else node = this.powerNodes[this.bottom];
    this.pendingOrigin = node ? { x: node.x, y: node.y } : null;
    this.refresh();
  }

  private clearPending(refresh = true): void {
    const had = this.pending !== null;
    this.pending = null;
    this.pendingOrigin = null;
    this.arrow.clear();
    if (refresh && had) this.refresh();
  }

  private refresh(): void {
    if (this.state) this.applyState(null, this.state);
  }

  // -------------------------------------------------------------------------
  // Hover zoom + status panel
  // -------------------------------------------------------------------------

  private onHover(id: string, over: boolean): void {
    const node = this.nodes.get(id);
    const slot = this.lastSlots.get(id);
    if (!node || !slot || !this.state) return;
    // Card backs (opponent hand) don't zoom or reveal anything.
    if (slot.mode === "back") return;

    if (over) {
      this.hoveredId = id;
      node.zIndex = 35;
      this.tweens.to(node.scale, { x: 1.16, y: 1.16 }, 120);
      // Lift bottom-hand cards so the zoom doesn't clip off-canvas.
      if (slot.zone === "hand") {
        this.tweens.to(node, { y: slot.y - 22 }, 120);
      }
      if (slot.zone === "board") this.showStatusPanel(slot.card, slot);
    } else {
      if (this.hoveredId === id) this.hoveredId = null;
      node.zIndex = slot.zone === "hand" ? 20 : 10;
      this.tweens.to(node.scale, { x: 1, y: 1 }, 120);
      this.tweens.to(node, { x: slot.x, y: slot.y }, 120);
      this.hideStatusPanel();
    }
  }

  private showStatusPanel(card: CardInstance, slot: Slot): void {
    this.hideStatusPanel();
    const entries = statusEntries(card);
    if (entries.length === 0) return;

    const panel = new PIXI.Container();
    const rowH = 20;
    const padX = 10;
    const padY = 8;
    const width = 150;
    const height = entries.length * rowH + padY * 2;

    const bg = new PIXI.Graphics();
    bg.lineStyle({ width: 2, color: 0x2c3e5c });
    bg.beginFill(0x0b0f19, 0.94);
    bg.drawRoundedRect(0, 0, width, height, 8);
    bg.endFill();
    panel.addChild(bg);

    entries.forEach((entry, i) => {
      const t = label(entry.text, 12, entry.buff ? BUFF_COLOR : DEBUFF_COLOR, {
        fontWeight: "600",
      });
      t.anchor.set(0, 0.5);
      t.position.set(padX, padY + rowH * i + rowH / 2);
      panel.addChild(t);
    });

    // Right of the card, or left when too close to the edge.
    const gap = MINION.w / 2 + 14;
    const px =
      slot.x + gap + width > this.w - 8 ? slot.x - gap - width : slot.x + gap;
    panel.position.set(px, slot.y - height / 2);
    panel.eventMode = "none";
    this.fxLayer.addChild(panel);
    this.statusPanel = panel;
  }

  private hideStatusPanel(): void {
    if (this.statusPanel) {
      this.statusPanel.destroy({ children: true });
      this.statusPanel = null;
    }
  }

  /** Pulse a colored ring around a card frame (green buff / red debuff). */
  private frameAura(x: number, y: number, buff: boolean): void {
    const { w, h } = MINION;
    const g = new PIXI.Graphics();
    g.lineStyle({ width: 5, color: buff ? BUFF_COLOR : DEBUFF_COLOR, alpha: 0.95 });
    g.drawRoundedRect(-w / 2 - 6, -h / 2 - 6, w + 12, h + 12, 13);
    g.position.set(x, y);
    g.scale.set(0.94);
    this.fxLayer.addChild(g);
    this.tweens.to(g.scale, { x: 1.1, y: 1.1 }, 500, easeOutCubic);
    this.tweens.to(g, { alpha: 0 }, 900, easeOutCubic, () => g.destroy());
  }

  // -------------------------------------------------------------------------
  // FX
  // -------------------------------------------------------------------------

  private drawArrow(tx: number, ty: number): void {
    const o = this.pendingOrigin;
    this.arrow.clear();
    if (!o) return;
    this.arrow.lineStyle({ width: 6, color: 0xf87171, alpha: 0.9 });
    this.arrow.moveTo(o.x, o.y);
    this.arrow.lineTo(tx, ty);
    this.arrow.beginFill(0xf87171);
    this.arrow.drawCircle(tx, ty, 9);
    this.arrow.endFill();
  }

  private positionOf(ref: CharRef): { x: number; y: number } | null {
    if (ref.kind === "hero") {
      const n = this.heroNodes[ref.player];
      return { x: n.x, y: n.y };
    }
    const n = this.nodes.get(ref.instanceId);
    return n ? { x: n.x, y: n.y } : null;
  }

  private spawnCombatFloats(
    prev: GameState,
    next: GameState,
    slots: Map<string, Slot>,
  ): void {
    const sounds = new Set<SfxName>();
    const prevMinions = new Map<string, CardInstance>();
    for (const p of [0, 1] as const)
      for (const m of prev.players[p].board) prevMinions.set(m.instanceId, m);

    for (const p of [0, 1] as const) {
      const nextIds = new Set(next.players[p].board.map((m) => m.instanceId));
      for (const m of prev.players[p].board) {
        if (!nextIds.has(m.instanceId)) sounds.add("minion_death");
      }

      for (const m of next.players[p].board) {
        const before = prevMinions.get(m.instanceId);
        if (!before) continue;
        if (before.divineShield && !m.divineShield) sounds.add("divine_shield_break");
        if (!before.frozen && m.frozen) sounds.add("freeze");
        const delta = m.health - before.health;
        if (delta > 0) sounds.add("heal");
        const slot = slots.get(m.instanceId);
        if (delta !== 0 && slot) this.floatText(delta, slot.x, slot.y);

        // Frame aura on buffs/debuffs (stat changes and status effects).
        const buffed =
          m.attack > before.attack ||
          m.maxHealth > before.maxHealth ||
          (!before.divineShield && m.divineShield);
        const debuffed =
          m.attack < before.attack ||
          (!before.frozen && m.frozen) ||
          (before.divineShield && !m.divineShield);
        if (slot && buffed) this.frameAura(slot.x, slot.y, true);
        if (slot && debuffed) this.frameAura(slot.x, slot.y, false);
      }

      const hBefore = prev.players[p].hero.health + prev.players[p].hero.armor;
      const hAfter = next.players[p].hero.health + next.players[p].hero.armor;
      if (hAfter !== hBefore) {
        if (hAfter < hBefore) sounds.add("hero_damage");
        else sounds.add("heal");
        const heroY = p === this.bottom ? this.m.bottomHero : this.m.topHero;
        this.floatText(hAfter - hBefore, this.w / 2, heroY);
      }
    }

    // Your own draws (turn start, card effects) — not the opponent's.
    if (
      next.players[this.bottom].hand.length > prev.players[this.bottom].hand.length
    ) {
      sounds.add("card_draw");
    }

    // Stagger distinct sounds slightly so simultaneous events stay readable.
    let i = 0;
    for (const name of sounds) playSfx(name, i++ * 100);
  }

  private floatText(delta: number, x: number, y: number): void {
    const str = delta > 0 ? `+${delta}` : String(delta);
    const t = label(str, 30, delta < 0 ? 0xf87171 : 0x4ade80, { fontWeight: "800" });
    t.position.set(x, y - 20);
    this.fxLayer.addChild(t);
    this.tweens.to(t, { y: y - 78, alpha: 0 }, 800, easeOutCubic, () => {
      t.destroy();
    });
  }

  private toast(msg: string): void {
    playSfx("invalid_action");
    const t = label(msg, 21, 0xfecaca, { fontWeight: "700" });
    t.position.set(this.w / 2, this.h / 2 - 30);
    this.fxLayer.addChild(t);
    this.tweens.to(t, { y: this.h / 2 - 90, alpha: 0 }, 1300, easeOutCubic, () => {
      t.destroy();
    });
  }
}

/** Active buffs (green) and debuffs (red) on a minion vs its printed card. */
function statusEntries(card: CardInstance): { text: string; buff: boolean }[] {
  const def = getCardDef(card.defId);
  const out: { text: string; buff: boolean }[] = [];
  const baseAtk = def.attack ?? 0;
  const baseHp = def.health ?? 0;

  if (card.attack > baseAtk) out.push({ text: `+${card.attack - baseAtk} Attack`, buff: true });
  if (card.attack < baseAtk) out.push({ text: `${card.attack - baseAtk} Attack`, buff: false });
  if (card.maxHealth > baseHp) out.push({ text: `+${card.maxHealth - baseHp} Health`, buff: true });
  if (card.maxHealth < baseHp) out.push({ text: `${card.maxHealth - baseHp} Health`, buff: false });
  if (card.divineShield) out.push({ text: "Divine Shield", buff: true });
  // Keywords granted after the card was printed (e.g. by future card effects).
  for (const k of card.keywords) {
    if (k === "divineShield") continue;
    if (!(def.keywords ?? []).includes(k)) {
      out.push({ text: k.charAt(0).toUpperCase() + k.slice(1), buff: true });
    }
  }
  if (card.health < card.maxHealth) {
    out.push({ text: `Damaged ${card.health}/${card.maxHealth}`, buff: false });
  }
  if (card.frozen) out.push({ text: "Frozen", buff: false });
  return out;
}

function locate(
  state: GameState,
  id: string,
): { card: CardInstance; owner: PlayerIndex; zone: "hand" | "board" } | null {
  for (const p of [0, 1] as const) {
    const pl = state.players[p];
    const inHand = pl.hand.find((c) => c.instanceId === id);
    if (inHand) return { card: inHand, owner: p, zone: "hand" };
    const onBoard = pl.board.find((c) => c.instanceId === id);
    if (onBoard) return { card: onBoard, owner: p, zone: "board" };
  }
  return null;
}
