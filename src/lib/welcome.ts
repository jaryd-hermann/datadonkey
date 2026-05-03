// Tracks which bots have already received the welcome chat message, so the
// dispatcher (status polling) and the webhook (first transcript) don't both
// send one. In-memory; resets on server restart.

const WELCOMED = new Set<string>();

export function isWelcomed(botId: string): boolean {
  return WELCOMED.has(botId);
}

export function markWelcomed(botId: string): void {
  WELCOMED.add(botId);
}
