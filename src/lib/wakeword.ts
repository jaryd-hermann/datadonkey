// Matches "Hey PostHog" / "Hi PostHog" / "OK PostHog" / "Hello PostHog" with
// the brand spelled any of: "PostHog", "post hog", "post-hog" (transcribers
// vary). A trailing comma is allowed: "Hey, PostHog".
const WAKE_RE = /\b(hey|hi|ok|hello|yo)[,\s]+post[\s-]?hog\b[,.!?:\s]*/i;

export interface WakeMatch {
  // Empty string when only the wake phrase was heard with no follow-up.
  question: string;
}

export function detectWakeWord(text: string): WakeMatch | null {
  const m = WAKE_RE.exec(text);
  if (!m) return null;
  const question = text.slice(m.index + m[0].length).trim();
  return { question };
}
