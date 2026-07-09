// Deck management screens: the deck list (DecksScreen) and the collection
// browser / deck editor (DeckEditor). Persistence is owned by App, which
// passes the custom decks in and receives save/delete events.

import { useMemo, useState } from "react";
import {
  allHeroes,
  collectibleCards,
  getCardDef,
  getHero,
  validateDeck,
  DECK_SIZE,
  MAX_COPIES,
  MAX_LEGENDARY_COPIES,
  type CardDef,
} from "@arcaneclash/engine";
import type { DeckData } from "./game/decks";
import { playSfx } from "./game/sfx";
import { CardTile } from "./CardTile";

// ---------------------------------------------------------------------------
// Deck list
// ---------------------------------------------------------------------------

export function DecksScreen({
  decks,
  onBack,
  onNew,
  onEdit,
  onDelete,
}: {
  decks: DeckData[];
  onBack: () => void;
  onNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="decks-screen">
      <header className="builder-bar">
        <button className="menu-btn" onClick={onBack}>
          ← Menu
        </button>
        <h2>Your Decks</h2>
        <button onClick={onNew}>+ New Deck</button>
      </header>
      <ul className="deck-list">
        {decks.map((d) => (
          <li key={d.id}>
            <span className="deck-name">{d.name}</span>
            <span className="deck-meta">
              {getHero(d.heroId).name} ({getHero(d.heroId).cardClass})
            </span>
            <button className="small" onClick={() => onEdit(d.id)}>
              Edit
            </button>
            <button className="small danger" onClick={() => onDelete(d.id)}>
              Delete
            </button>
          </li>
        ))}
        {decks.length === 0 && (
          <li className="empty">
            No custom decks yet — the six hero starter decks are always
            available from the menu. Build your own here!
          </li>
        )}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export function DeckEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: DeckData | null;
  onSave: (deck: DeckData) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [heroId, setHeroId] = useState(initial?.heroId ?? "merlin");
  const [cards, setCards] = useState<string[]>(initial ? [...initial.cards] : []);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "minion" | "spell">("all");

  const heroClass = getHero(heroId).cardClass;

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) m.set(c, (m.get(c) ?? 0) + 1);
    return m;
  }, [cards]);

  // Collection view: neutral cards + the chosen hero's class cards.
  const collection = useMemo(
    () =>
      collectibleCards()
        .filter((def) => {
          const cls = def.cardClass ?? "neutral";
          return cls === "neutral" || cls === heroClass;
        })
        .sort((a, b) => {
          const clsA = (a.cardClass ?? "neutral") === "neutral" ? 1 : 0;
          const clsB = (b.cardClass ?? "neutral") === "neutral" ? 1 : 0;
          return clsA - clsB || a.cost - b.cost || a.name.localeCompare(b.name);
        }),
    [heroClass],
  );

  const visible = collection.filter((def) => {
    if (typeFilter !== "all" && def.type !== typeFilter) return false;
    if (search && !def.name.toLowerCase().includes(search.toLowerCase()))
      return false;
    return true;
  });

  const limitOf = (def: CardDef) =>
    def.rarity === "legendary" ? MAX_LEGENDARY_COPIES : MAX_COPIES;

  const add = (def: CardDef) => {
    if (cards.length >= DECK_SIZE) return;
    if ((counts.get(def.id) ?? 0) >= limitOf(def)) return;
    playSfx("deck_add_card");
    setCards([...cards, def.id]);
  };

  const removeOne = (id: string) => {
    const i = cards.indexOf(id);
    if (i < 0) return;
    playSfx("deck_remove_card");
    const next = [...cards];
    next.splice(i, 1);
    setCards(next);
  };

  /** Switching hero drops any cards the new class can't run. */
  const switchHero = (id: string) => {
    setHeroId(id);
    const cls = getHero(id).cardClass;
    setCards(
      cards.filter((c) => {
        const cardCls = getCardDef(c).cardClass ?? "neutral";
        return cardCls === "neutral" || cardCls === cls;
      }),
    );
  };

  const deckRows = [...counts.entries()]
    .map(([id, n]) => ({ def: getCardDef(id), n }))
    .sort((a, b) => a.def.cost - b.def.cost || a.def.name.localeCompare(b.def.name));

  const curve = useMemo(() => {
    const buckets = new Array<number>(8).fill(0);
    for (const id of cards) buckets[Math.min(getCardDef(id).cost, 7)] += 1;
    return buckets;
  }, [cards]);
  const curveMax = Math.max(1, ...curve);

  const deckError = validateDeck(cards, heroClass);
  const canSave = deckError === null && name.trim().length > 0;
  const status =
    cards.length < DECK_SIZE
      ? `${cards.length}/${DECK_SIZE} cards`
      : deckError ?? (name.trim() ? "Ready to save" : "Name your deck");

  const save = () => {
    if (!canSave) return;
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      heroId,
      cards,
    });
  };

  return (
    <div className="builder">
      <header className="builder-bar">
        <button className="menu-btn" onClick={onCancel}>
          ← Back
        </button>
        <input
          className="deck-name-input"
          placeholder="Deck name"
          maxLength={24}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="hp-picker">
          {allHeroes().map((h) => (
            <button
              key={h.id}
              className={`small ${heroId === h.id ? "active" : ""}`}
              title={`${h.cardClass} — hero power: ${h.heroPowerId}`}
              onClick={() => switchHero(h.id)}
            >
              {h.name}
            </button>
          ))}
        </div>
        <span className={`deck-status ${canSave ? "ok" : ""}`}>{status}</span>
        <button disabled={!canSave} onClick={save}>
          Save Deck
        </button>
      </header>

      <div className="builder-main">
        <section className="collection">
          <div className="filters">
            <input
              placeholder="Search cards…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {(["all", "minion", "spell"] as const).map((t) => (
              <button
                key={t}
                className={`small ${typeFilter === t ? "active" : ""}`}
                onClick={() => setTypeFilter(t)}
              >
                {t === "all" ? "All" : t === "minion" ? "Minions" : "Spells"}
              </button>
            ))}
          </div>
          <div className="card-grid">
            {visible.map((def) => {
              const used = counts.get(def.id) ?? 0;
              const maxed = used >= limitOf(def) || cards.length >= DECK_SIZE;
              return (
                <CardFace
                  key={def.id}
                  def={def}
                  used={used}
                  limit={limitOf(def)}
                  disabled={maxed}
                  onClick={() => add(def)}
                />
              );
            })}
          </div>
        </section>

        <aside className="deck-panel">
          <h3>
            Deck ({cards.length}/{DECK_SIZE})
          </h3>
          <div className="curve">
            {curve.map((n, cost) => (
              <div className="curve-col" key={cost} title={`${n} cards`}>
                <div
                  className="curve-fill"
                  style={{ height: `${(n / curveMax) * 100}%` }}
                />
                <span>{cost === 7 ? "7+" : cost}</span>
              </div>
            ))}
          </div>
          <ul className="deck-rows">
            {deckRows.map(({ def, n }) => (
              <li key={def.id} onClick={() => removeOne(def.id)} title="Click to remove">
                <span className="row-cost">{def.cost}</span>
                <span className="row-name">{def.name}</span>
                <span className="row-count">×{n}</span>
              </li>
            ))}
            {deckRows.length === 0 && (
              <li className="empty">Click cards on the left to add them.</li>
            )}
          </ul>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card tile
// ---------------------------------------------------------------------------

function CardFace({
  def,
  used,
  limit,
  disabled,
  onClick,
}: {
  def: CardDef;
  used: number;
  limit: number;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <CardTile
      def={def}
      disabled={disabled}
      onClick={onClick}
      footer={
        <div className="cf-bottom">
          {def.type === "minion" ? (
            <>
              <span className="cf-atk">{def.attack}</span>
              <span className="cf-copies">
                {used}/{limit}
              </span>
              <span className="cf-hp">{def.health}</span>
            </>
          ) : (
            <span className="cf-copies center">
              {used}/{limit}
            </span>
          )}
        </div>
      }
    />
  );
}
