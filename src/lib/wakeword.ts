// Build a wake-word matcher for any data-tool brand. Tolerates greeting
// variants ("Hey/Hi/OK/Hello/Yo"), comma after the greeting, and the brand
// being transcribed as one word, two words, or hyphenated. Optionally allows
// the trailing syllable to drop (e.g. Deepgram drops "hog" from "PostHog").

import { ProviderConfig } from "./providers";

export interface WakeMatch {
  question: string; // empty if just the wake phrase was heard
}

// Splits a brand name into (head, tail) — the tail is treated as optional in
// the regex so transcribers that drop it still match. For one-word brands
// like "Mixpanel" or "Amplitude" we use a heuristic split (last 2-4 chars).
function splitBrand(brand: string): { head: string; tail?: string } {
  const lower = brand.toLowerCase();
  const m = lower.match(/^([a-z]+)([\s-]?)([a-z]+)$/);
  if (m) return { head: m[1], tail: m[3] };
  if (lower.length >= 6) {
    const tailLen = lower.length >= 8 ? 3 : 2;
    return { head: lower.slice(0, lower.length - tailLen), tail: lower.slice(-tailLen) };
  }
  return { head: lower };
}

export function buildWakeRegex(provider: ProviderConfig): RegExp {
  const { head, tail } = splitBrand(provider.name);
  const headEsc = head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tailGroup = tail
    ? `(?:[\\s-]?${tail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})?`
    : "";
  // \b before the brand head, then the optional tail, then word boundary +
  // any trailing punctuation/whitespace.
  return new RegExp(
    `\\b(?:hey|hi|ok|hello|yo)[,\\s]+${headEsc}${tailGroup}\\b[,.!?:\\s]*`,
    "i",
  );
}

export function detectWakeWord(
  text: string,
  provider: ProviderConfig,
): WakeMatch | null {
  const re = buildWakeRegex(provider);
  const m = re.exec(text);
  if (!m) return null;
  const question = text.slice(m.index + m[0].length).trim();
  return { question };
}
