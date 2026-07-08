// User accounts with scrypt password hashing and per-user deck storage,
// persisted to a JSON file. Tokens are in-memory: a server restart just
// means logging in again.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getHero, hasHero, validateDeck } from "../../engine/src/index";

export interface StoredDeck {
  id: string;
  name: string;
  heroId: string;
  cards: string[];
}

interface UserRecord {
  salt: string;
  hash: string;
  decks: StoredDeck[];
}

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const DATA_FILE = join(DATA_DIR, "users.json");
const MAX_DECKS = 50;

let users: Record<string, UserRecord> = loadUsers();
const tokens = new Map<string, string>(); // token -> username

function loadUsers(): Record<string, UserRecord> {
  try {
    if (!existsSync(DATA_FILE)) return {};
    return JSON.parse(readFileSync(DATA_FILE, "utf8")) as Record<string, UserRecord>;
  } catch {
    console.error("[accounts] could not read users.json, starting empty");
    return {};
  }
}

function persist(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), "utf8");
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString("hex");
}

function issueToken(username: string): string {
  const token = randomBytes(24).toString("hex");
  tokens.set(token, username);
  return token;
}

export type AuthResult = { token: string; username: string } | { error: string };

export function register(usernameRaw: unknown, password: unknown): AuthResult {
  if (typeof usernameRaw !== "string" || typeof password !== "string") {
    return { error: "Malformed request" };
  }
  const username = usernameRaw.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return { error: "Username must be 3-20 letters, digits or _" };
  }
  if (password.length < 4) return { error: "Password must be at least 4 characters" };
  const key = username.toLowerCase();
  if (users[key]) return { error: "Username is already taken" };
  const salt = randomBytes(16).toString("hex");
  users[key] = { salt, hash: hashPassword(password, salt), decks: [] };
  persist();
  console.log(`[accounts] registered ${username}`);
  return { token: issueToken(key), username };
}

export function login(usernameRaw: unknown, password: unknown): AuthResult {
  if (typeof usernameRaw !== "string" || typeof password !== "string") {
    return { error: "Malformed request" };
  }
  const key = usernameRaw.trim().toLowerCase();
  const rec = users[key];
  if (!rec) return { error: "Unknown username or wrong password" };
  const attempt = Buffer.from(hashPassword(password, rec.salt), "hex");
  const actual = Buffer.from(rec.hash, "hex");
  if (attempt.length !== actual.length || !timingSafeEqual(attempt, actual)) {
    return { error: "Unknown username or wrong password" };
  }
  return { token: issueToken(key), username: usernameRaw.trim() };
}

/** Resolve a bearer token to a username, or null. */
export function authenticate(token: unknown): string | null {
  if (typeof token !== "string") return null;
  return tokens.get(token) ?? null;
}

export function getDecks(username: string): StoredDeck[] {
  return users[username.toLowerCase()]?.decks ?? [];
}

/** Validate and replace a user's saved decks. Returns an error or null. */
export function setDecks(username: string, raw: unknown): string | null {
  if (!Array.isArray(raw)) return "Malformed decks";
  if (raw.length > MAX_DECKS) return `At most ${MAX_DECKS} decks`;
  const decks: StoredDeck[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return "Malformed deck";
    const d = item as Partial<StoredDeck>;
    if (
      typeof d.id !== "string" || d.id.length > 40 ||
      typeof d.name !== "string" || d.name.trim().length === 0 || d.name.length > 24 ||
      typeof d.heroId !== "string" || !hasHero(d.heroId) ||
      !Array.isArray(d.cards) || !d.cards.every((c) => typeof c === "string")
    ) {
      return "Malformed deck";
    }
    const err = validateDeck(d.cards, getHero(d.heroId).cardClass);
    if (err) return `Illegal deck "${d.name}": ${err}`;
    decks.push({ id: d.id, name: d.name.trim(), heroId: d.heroId, cards: [...d.cards] });
  }
  const rec = users[username.toLowerCase()];
  if (!rec) return "Unknown user";
  rec.decks = decks;
  persist();
  return null;
}
