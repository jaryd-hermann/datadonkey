// Matches "Hey PostHog" / "Hi PostHog" / "OK PostHog" with the brand spelled
// any of: "PostHog", "post hog", "post-hog" (Deepgram transcribes inconsistently).
const WAKE_RE = /\b(hey|hi|ok)\s+post[\s-]?hog[,.!?:\s]*/i;

export interface WakeMatch {
  question: string;
}

export function detectWakeWord(text: string): WakeMatch | null {
  const m = WAKE_RE.exec(text);
  if (!m) return null;
  const question = text.slice(m.index + m[0].length).trim();
  if (question.length < 3) return null;
  return { question };
}
