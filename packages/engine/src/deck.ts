// Deck construction rules, shared by the client (builder UI) and the
// server (validating decks submitted at matchmaking).

import { getCardDef } from "./registry";
import type { CardClass } from "./types";

export const DECK_SIZE = 30;
export const MAX_COPIES = 2;
export const MAX_LEGENDARY_COPIES = 1;

export function copyLimit(cardId: string): number {
  return getCardDef(cardId).rarity === "legendary"
    ? MAX_LEGENDARY_COPIES
    : MAX_COPIES;
}

/**
 * Returns an error message, or null if the deck is legal for the given class.
 * A deck may contain neutral cards plus cards of its own class only.
 */
export function validateDeck(
  cardIds: string[],
  deckClass: CardClass,
): string | null {
  if (!Array.isArray(cardIds) || cardIds.length !== DECK_SIZE) {
    return `A deck must have exactly ${DECK_SIZE} cards`;
  }
  const counts = new Map<string, number>();
  for (const id of cardIds) {
    let name: string;
    let token: boolean;
    let legendary: boolean;
    let cardClass: CardClass;
    try {
      const def = getCardDef(id);
      name = def.name;
      token = def.token === true;
      legendary = def.rarity === "legendary";
      cardClass = def.cardClass ?? "neutral";
    } catch {
      return `Unknown card: ${id}`;
    }
    if (token) return `${name} is not a collectible card`;
    if (cardClass !== "neutral" && cardClass !== deckClass) {
      return `${name} is a ${cardClass} card and can't go in this deck`;
    }
    const n = (counts.get(id) ?? 0) + 1;
    counts.set(id, n);
    const limit = legendary ? MAX_LEGENDARY_COPIES : MAX_COPIES;
    if (n > limit) return `Too many copies of ${name} (max ${limit})`;
  }
  return null;
}
