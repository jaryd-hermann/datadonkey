// In-memory transcript buffers and per-bot debounce. Resets on server restart;
// fine for prototype, would move to Redis for production.

export interface Utterance {
  speaker: string | null;
  text: string;
  ts: number;
}

const BUFFERS = new Map<string, Utterance[]>();
const TIMEOUTS = new Map<string, NodeJS.Timeout>();
const RECENT_TRIGGERS = new Map<string, number>();

const MAX_BUFFER = 50;
const TRIGGER_COOLDOWN_MS = 4_000;

export function appendUtterance(botId: string, u: Utterance): void {
  const buf = BUFFERS.get(botId) ?? [];
  buf.push(u);
  if (buf.length > MAX_BUFFER) buf.shift();
  BUFFERS.set(botId, buf);
}

export function getRecentText(botId: string, lastN = 3): string {
  const buf = BUFFERS.get(botId) ?? [];
  return buf
    .slice(-lastN)
    .map((u) => u.text)
    .join(" ")
    .trim();
}

// Debounce a callback per-bot. Each call resets the timer; callback fires
// after `delayMs` of no further calls.
export function debounce(botId: string, delayMs: number, fn: () => void): void {
  const existing = TIMEOUTS.get(botId);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    TIMEOUTS.delete(botId);
    fn();
  }, delayMs);
  TIMEOUTS.set(botId, t);
}

// Returns true if this bot triggered within the cooldown window. Also marks
// the trigger time. Prevents the same wake-word firing twice from overlapping
// utterances.
export function shouldThrottle(botId: string): boolean {
  const last = RECENT_TRIGGERS.get(botId) ?? 0;
  const now = Date.now();
  if (now - last < TRIGGER_COOLDOWN_MS) return true;
  RECENT_TRIGGERS.set(botId, now);
  return false;
}
