// Deck persistence: logged-in users' decks live on the server; guests use
// localStorage. Built-in starter decks (one per hero) are generated, not stored.

import {
  allHeroes,
  getHero,
  hasHero,
  starterDeckFor,
  validateDeck,
} from "@arcaneclash/engine";
import { apiBase, type Session } from "./auth";

export interface DeckData {
  id: string;
  name: string;
  heroId: string;
  cards: string[];
  builtin?: boolean;
}

const DECKS_KEY = "arcaneclash.decks";
const SELECTED_KEY = "arcaneclash.selectedDeck";

export function builtinDecks(): DeckData[] {
  return allHeroes().map((h) => ({
    id: `starter_${h.id}`,
    name: `${h.name} Starter`,
    heroId: h.id,
    cards: starterDeckFor(h.id),
    builtin: true,
  }));
}

function isLegal(d: DeckData): boolean {
  return (
    hasHero(d.heroId) && validateDeck(d.cards, getHero(d.heroId).cardClass) === null
  );
}

/** Accept old-format local decks (pre-classes) by mapping their hero power. */
function migrate(raw: unknown): DeckData | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Partial<DeckData> & { heroPowerId?: string };
  if (
    typeof d.id !== "string" ||
    typeof d.name !== "string" ||
    !Array.isArray(d.cards)
  ) {
    return null;
  }
  let heroId = typeof d.heroId === "string" ? d.heroId : "";
  if (!hasHero(heroId)) {
    heroId = d.heroPowerId === "hp_bulwark" ? "lancelot" : "merlin";
  }
  const deck: DeckData = { id: d.id, name: d.name, heroId, cards: d.cards };
  return isLegal(deck) ? deck : null;
}

function loadLocal(): DeckData[] {
  try {
    const raw = localStorage.getItem(DECKS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(migrate)
      .filter((d): d is DeckData => d !== null);
  } catch {
    return [];
  }
}

function saveLocal(decks: DeckData[]): void {
  localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
}

/** Load custom decks from the account (if logged in) or localStorage. */
export async function fetchCustomDecks(session: Session | null): Promise<DeckData[]> {
  if (!session) return loadLocal();
  const res = await fetch(`${apiBase()}/api/decks`, {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  if (res.status === 401) throw new Error("Session expired — please log in again");
  if (!res.ok) throw new Error("Could not load decks from the server");
  const body = (await res.json()) as { decks?: unknown };
  if (!Array.isArray(body.decks)) return [];
  return body.decks.map(migrate).filter((d): d is DeckData => d !== null);
}

/** Persist the full custom-deck list to the account or localStorage. */
export async function persistCustomDecks(
  session: Session | null,
  decks: DeckData[],
): Promise<void> {
  const clean = decks.map(({ id, name, heroId, cards }) => ({
    id,
    name,
    heroId,
    cards,
  }));
  if (!session) {
    saveLocal(clean);
    return;
  }
  const res = await fetch(`${apiBase()}/api/decks`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    },
    body: JSON.stringify({ decks: clean }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not save decks to the server");
  }
}

export function getSelectedDeckId(): string {
  return localStorage.getItem(SELECTED_KEY) ?? "starter_merlin";
}

export function setSelectedDeckId(id: string): void {
  localStorage.setItem(SELECTED_KEY, id);
}

/** Resolve a deck id against builtins + customs, falling back to a starter. */
export function resolveDeck(id: string, customs: DeckData[]): DeckData {
  return (
    [...builtinDecks(), ...customs].find((d) => d.id === id) ?? builtinDecks()[0]
  );
}
