// Client-side account/session handling against the server's HTTP API.

export interface Session {
  token: string;
  username: string;
}

const SESSION_KEY = "arcaneclash.session";

export function apiBase(): string {
  return `http://${location.hostname}:8787`;
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return typeof s.token === "string" && typeof s.username === "string" ? s : null;
  } catch {
    return null;
  }
}

export function storeSession(session: Session | null): void {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

async function authRequest(
  path: "/api/register" | "/api/login",
  username: string,
  password: string,
): Promise<Session> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error("Could not reach the server — is it running?");
  }
  const body = (await res.json()) as { token?: string; username?: string; error?: string };
  if (!res.ok || !body.token || !body.username) {
    throw new Error(body.error ?? "Request failed");
  }
  const session = { token: body.token, username: body.username };
  storeSession(session);
  return session;
}

export function register(username: string, password: string): Promise<Session> {
  return authRequest("/api/register", username, password);
}

export function login(username: string, password: string): Promise<Session> {
  return authRequest("/api/login", username, password);
}
