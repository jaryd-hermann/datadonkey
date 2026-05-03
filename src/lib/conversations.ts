// Per-bot conversation history so follow-up wake-words have context from
// earlier questions in the same meeting. In-memory + TTL — fine for proto.

interface Turn {
  role: "user" | "assistant";
  content: string;
}

interface BotConversation {
  turns: Turn[];
  lastActivity: number;
}

const CONVERSATIONS = new Map<string, BotConversation>();
const MAX_TURNS = 8; // 4 Q&A pairs
const TTL_MS = 5 * 60_000;

export function getHistory(botId: string): Turn[] {
  const c = CONVERSATIONS.get(botId);
  if (!c) return [];
  if (Date.now() - c.lastActivity > TTL_MS) {
    CONVERSATIONS.delete(botId);
    return [];
  }
  return c.turns.slice();
}

export function appendTurn(botId: string, role: Turn["role"], content: string): void {
  const c = CONVERSATIONS.get(botId) ?? { turns: [], lastActivity: Date.now() };
  c.turns.push({ role, content });
  // Trim oldest pairs first; keep only the most recent MAX_TURNS messages.
  if (c.turns.length > MAX_TURNS) c.turns = c.turns.slice(c.turns.length - MAX_TURNS);
  c.lastActivity = Date.now();
  CONVERSATIONS.set(botId, c);
}

export function clearConversation(botId: string): void {
  CONVERSATIONS.delete(botId);
}
