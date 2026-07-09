// Shared flat Tarot tile markup for compact DOM card surfaces (deck builder,
// mulligan). Renders the cost cartouche, name, class badge, and rules text;
// callers supply their own footer (stats/copies) and an optional stamp
// overlay (e.g. mulligan's REPLACE mark). See REDESIGN_ROADMAP.md §2 — these
// are compact tiles, not the full board card frame (that's PixiJS/board.ts).

import type { ReactNode } from "react";
import type { CardDef } from "@arcaneclash/engine";
import { roman } from "./game/theme";

export function CardTile({
  def,
  extraClass,
  disabled,
  showClass = true,
  onClick,
  footer,
  stamp,
}: {
  def: CardDef;
  extraClass?: string;
  disabled?: boolean;
  showClass?: boolean;
  onClick?: () => void;
  footer?: ReactNode;
  stamp?: ReactNode;
}) {
  const cls = def.cardClass ?? "neutral";
  return (
    <div
      className={`cardface rarity-${def.rarity ?? "common"} ${def.type} ${
        disabled ? "disabled" : ""
      } ${extraClass ?? ""}`}
      onClick={onClick}
    >
      <div className="cf-top">
        <span className="cf-cost">{roman(def.cost)}</span>
        <span className="cf-name">{def.name}</span>
      </div>
      {showClass && cls !== "neutral" && <div className="cf-class">{cls}</div>}
      {def.text && <div className="cf-text">{def.text}</div>}
      {footer}
      {stamp}
    </div>
  );
}
