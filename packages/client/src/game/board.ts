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

const HERO_POWER_SFX: Record<string, SfxName> = {
  hp_flame: "hero_power_flame",
  hp_bargain: "hero_power_bargain",
  hp_rally: "hero_power_rally",
  hp_bulwark: "hero_power_bulwark",
  hp_mend: "hero_power_mend",
  hp_shot: "hero_power_shot",
};

export const VIEW_W = 1280;
export const VIEW_H = 800;

const HAND = { w: 104, h: 148 };
const MINION = { w: 92, h: 118 };

const Y = {
  topHand: 62,
  topHero: 182,
  topBoard: 320,
  bottomBoard: 462,
  bottomHero: 600,
  bottomHand: 722,
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
    fontFamily: "Segoe UI, Arial, sans-serif",
    fontSize: size,
    fill,
    fontWeight: "600",
    align: "center",
    ...extra,
  });
  t.anchor.set(0.5);
  return t;
}

function clearChildren(c: PIXI.Container): void {
  while (c.children.length > 0) {
    c.children[0].destroy({ children: true, texture: true, baseTexture: true });
  }
}

function statGem(x: number, y: number, color: number, value: string, dim = 14): PIXI.Container {
  const wrap = new PIXI.Container();
  const g = new PIXI.Graphics();
  g.lineStyle({ width: 2, color: 0x0b0f19 });
  g.beginFill(color);
  g.drawCircle(0, 0, dim);
  g.endFill();
  wrap.addChild(g, label(value, dim, 0xffffff, { fontWeight: "700" }));
  wrap.position.set(x, y);
  return wrap;
}

function drawHandCard(
  node: PIXI.Container,
  card: CardInstance,
  def: CardDef,
  canAct: boolean,
  selected: boolean,
): void {
  const { w, h } = HAND;
  const g = new PIXI.Graphics();
  const border = selected ? 0xfacc15 : canAct ? 0x4ade80 : 0x0b0f19;
  g.lineStyle({ width: 3, color: border });
  g.beginFill(def.type === "spell" ? 0x24405c : 0x40365a);
  g.drawRoundedRect(-w / 2, -h / 2, w, h, 10);
  g.endFill();
  node.addChild(g);

  node.addChild(statGem(-w / 2 + 16, -h / 2 + 16, 0x2563eb, String(def.cost)));

  const name = label(def.name, 11, 0xffffff, {
    wordWrap: true,
    wordWrapWidth: w - 16,
  });
  name.position.set(0, -h / 2 + 44);
  node.addChild(name);

  if (def.text) {
    const text = label(def.text, 9, 0xcbd5e1, {
      wordWrap: true,
      wordWrapWidth: w - 16,
      fontWeight: "400",
    });
    text.position.set(0, h * 0.13);
    node.addChild(text);
  }

  if (def.type === "minion") {
    node.addChild(statGem(-w / 2 + 15, h / 2 - 15, 0xd97706, String(card.attack)));
    node.addChild(statGem(w / 2 - 15, h / 2 - 15, 0xdc2626, String(card.health)));
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
  if (card.divineShield) {
    const glow = new PIXI.Graphics();
    glow.lineStyle({ width: 5, color: 0xfde047, alpha: 0.9 });
    glow.drawRoundedRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10, 14);
    node.addChild(glow);
  }
  const taunt = card.keywords.includes("taunt");
  const g = new PIXI.Graphics();
  const border = selected ? 0xfacc15 : canAct ? 0x4ade80 : taunt ? 0x94a3b8 : 0x0b0f19;
  g.lineStyle({ width: taunt ? 5 : 3, color: border });
  g.beginFill(taunt ? 0x3f4655 : 0x374151);
  g.drawRoundedRect(-w / 2, -h / 2, w, h, 10);
  g.endFill();
  node.addChild(g);

  const name = label(def.name, 10, 0xf1f5f9, {
    wordWrap: true,
    wordWrapWidth: w - 12,
  });
  name.position.set(0, -h / 2 + 26);
  node.addChild(name);

  const kw = card.keywords.filter((k) => k !== "divineShield").join(" · ");
  if (kw) {
    const t = label(kw, 8, 0xa5b4fc, { fontWeight: "400" });
    t.position.set(0, 6);
    node.addChild(t);
  }

  node.addChild(statGem(-w / 2 + 14, h / 2 - 14, 0xd97706, String(card.attack), 13));
  const hpColor = card.health < card.maxHealth ? 0xf87171 : 0xffffff;
  const hp = statGem(w / 2 - 14, h / 2 - 14, 0xdc2626, "", 13);
  hp.addChild(label(String(card.health), 13, hpColor, { fontWeight: "700" }));
  node.addChild(hp);
}

function drawCardBack(node: PIXI.Container): void {
  const { w, h } = HAND;
  const g = new PIXI.Graphics();
  g.lineStyle({ width: 3, color: 0x0b0f19 });
  g.beginFill(0x4c2a85);
  g.drawRoundedRect(-w / 2, -h / 2, w, h, 10);
  g.endFill();
  g.lineStyle({ width: 3, color: 0x8b5cf6, alpha: 0.7 });
  g.drawCircle(0, 0, 28);
  g.drawCircle(0, 0, 16);
  g.endFill();
  node.addChild(g);
}

// ---------------------------------------------------------------------------
// Card node
// ---------------------------------------------------------------------------

class CardNode extends PIXI.Container {
  readonly id: string;
  zone: "hand" | "board" = "hand";

  constructor(id: string, onTap: (id: string) => void) {
    super();
    this.id = id;
    this.eventMode = "static";
    this.cursor = "pointer";
    this.on("pointertap", (e: PIXI.FederatedPointerEvent) => {
      e.stopPropagation();
      onTap(this.id);
    });
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
  private bottom: PlayerIndex = 0;
  private submit: (a: Action) => string | null;
  private seatNames: [string, string];

  constructor(
    parent: HTMLElement,
    submit: (a: Action) => string | null,
    seatNames: [string, string],
  ) {
    this.submit = submit;
    this.seatNames = seatNames;
    this.app = new PIXI.Application({
      width: VIEW_W,
      height: VIEW_H,
      backgroundColor: 0x151d2b,
      antialias: true,
    });
    const view = this.app.view as HTMLCanvasElement;
    view.style.width = "100%";
    view.style.height = "auto";
    view.style.display = "block";
    view.style.borderRadius = "12px";
    view.addEventListener("contextmenu", (e) => e.preventDefault());
    parent.appendChild(view);

    this.tweens = new Tweens(this.app.ticker);

    const stage = this.app.stage;
    stage.eventMode = "static";
    stage.hitArea = new PIXI.Rectangle(0, 0, VIEW_W, VIEW_H);
    stage.sortableChildren = true;

    const decor = new PIXI.Graphics();
    decor.zIndex = 0;
    decor.beginFill(0x1d2a40);
    decor.drawRoundedRect(VIEW_W / 2 - 440, Y.topBoard - 66, 880, 132, 16);
    decor.drawRoundedRect(VIEW_W / 2 - 440, Y.bottomBoard - 66, 880, 132, 16);
    decor.endFill();
    decor.lineStyle({ width: 2, color: 0x2c3e5c });
    decor.moveTo(VIEW_W / 2 - 420, (Y.topBoard + Y.bottomBoard) / 2);
    decor.lineTo(VIEW_W / 2 + 420, (Y.topBoard + Y.bottomBoard) / 2);
    stage.addChild(decor);

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
  }

  destroy(): void {
    this.app.destroy(true, { children: true, texture: true, baseTexture: true });
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

    for (const [id, node] of [...this.nodes]) {
      if (!slots.has(id)) {
        this.nodes.delete(id);
        node.eventMode = "none";
        this.tweens.to(node, { alpha: 0 }, 300, easeOutCubic, () => {
          node.destroy({ children: true });
        });
      }
    }

    for (const [id, slot] of slots) {
      let node = this.nodes.get(id);
      if (!node) {
        node = new CardNode(id, (nid) => this.onCardTap(nid));
        this.nodes.set(id, node);
        this.cardLayer.addChild(node);
        if (slot.zone === "hand") {
          node.position.set(VIEW_W - 50, slot.y); // drawn from the deck
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
      const heroY = isBottom ? Y.bottomHero : Y.topHero;
      this.redrawHero(p, state);
      this.redrawHeroPower(p, state);
      this.tweens.to(this.heroNodes[p], { x: VIEW_W / 2, y: heroY }, 260);
      this.tweens.to(this.powerNodes[p], { x: VIEW_W / 2 + 116, y: heroY }, 260);
    }

    if (prev) this.spawnCombatFloats(prev, state, slots);
  }

  private computeLayout(state: GameState): Map<string, Slot> {
    const slots = new Map<string, Slot>();
    for (const p of [0, 1] as const) {
      const pl = state.players[p];
      const isBottom = p === this.bottom;
      const myTurn = state.active === p && state.phase === "playing";

      const handY = isBottom ? Y.bottomHand : Y.topHand;
      const n = pl.hand.length;
      const spacing = Math.min(HAND.w + 6, 720 / Math.max(n, 1));
      const x0 = VIEW_W / 2 - ((n - 1) * spacing) / 2;
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

      const boardY = isBottom ? Y.bottomBoard : Y.topBoard;
      const bn = pl.board.length;
      const bSpacing = MINION.w + 14;
      const bx0 = VIEW_W / 2 - ((bn - 1) * bSpacing) / 2;
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
    const g = new PIXI.Graphics();
    g.lineStyle({ width: 3, color: 0x0b0f19 });
    g.beginFill(p === this.bottom ? 0x3b4a63 : 0x5b3a49);
    g.drawCircle(0, 0, 48);
    g.endFill();
    node.addChild(g);
    node.addChild(label(this.seatNames[p], 13, 0xf8fafc));
    node.addChild(statGem(34, 34, 0xdc2626, String(hero.health), 16));
    if (hero.armor > 0) node.addChild(statGem(-34, 34, 0x94a3b8, String(hero.armor), 14));
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
    g.lineStyle({ width: 3, color: usable ? 0x4ade80 : 0x0b0f19 });
    g.beginFill(pl.heroPowerUsed ? 0x3f3f46 : 0x6d28d9);
    g.drawCircle(0, 0, 27);
    g.endFill();
    node.addChild(g);
    const initials = hp.name.split(" ").map((w) => w[0] ?? "").join("");
    node.addChild(label(initials, 15, 0xffffff, { fontWeight: "700" }));
    node.addChild(statGem(0, -27, 0x2563eb, String(hp.cost), 10));
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
      }

      const hBefore = prev.players[p].hero.health + prev.players[p].hero.armor;
      const hAfter = next.players[p].hero.health + next.players[p].hero.armor;
      if (hAfter !== hBefore) {
        if (hAfter < hBefore) sounds.add("hero_damage");
        else sounds.add("heal");
        const heroY = p === this.bottom ? Y.bottomHero : Y.topHero;
        this.floatText(hAfter - hBefore, VIEW_W / 2, heroY);
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
    t.position.set(VIEW_W / 2, VIEW_H / 2 - 30);
    this.fxLayer.addChild(t);
    this.tweens.to(t, { y: VIEW_H / 2 - 90, alpha: 0 }, 1300, easeOutCubic, () => {
      t.destroy();
    });
  }
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
