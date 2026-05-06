import { prisma } from "./db";

// Anthropic API pricing (per 1M tokens) as of 2026-05.
// Update these if pricing changes.
export const PRICING = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-7": { input: 15.0, output: 75.0 },
} as const;

// Recall.ai bot + transcription is roughly $0.50/hour with Deepgram.
const RECALL_PER_HOUR_USD = 0.5;

export type ModelId = keyof typeof PRICING;

export interface UsageEntry {
  stage: "analyze" | "strategic" | "preamble" | "live" | "other";
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  ts: number;
  detail?: string;
}

export interface UsageRollup {
  entries: UsageEntry[];
  recallSeconds?: number;
  recallCostUsd?: number;
}

export function tokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = (PRICING as Record<string, { input: number; output: number }>)[model];
  if (!p) return 0;
  return (
    (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output
  );
}

// Append a single LLM call to the meeting's usage rollup. Idempotent enough
// that minor races (concurrent appends) just produce slightly inflated lists
// — fine for a usage ledger, especially since we don't reconcile in real time.
export async function recordUsage(
  meetingId: string,
  entry: Omit<UsageEntry, "ts" | "costUsd"> & { costUsd?: number },
): Promise<void> {
  const cost =
    entry.costUsd ?? tokenCost(entry.model, entry.inputTokens, entry.outputTokens);
  try {
    const m = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { usageJson: true, costUsd: true },
    });
    if (!m) return;
    let rollup: UsageRollup = { entries: [] };
    if (m.usageJson) {
      try {
        rollup = JSON.parse(m.usageJson) as UsageRollup;
      } catch {}
    }
    rollup.entries.push({ ...entry, ts: Date.now(), costUsd: cost });
    const newCost = (m.costUsd ?? 0) + cost;
    await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        usageJson: JSON.stringify(rollup),
        costUsd: newCost,
      },
    });
  } catch (err) {
    console.warn("[usage] recordUsage failed:", err);
  }
}

export async function recordRecallSeconds(
  meetingId: string,
  seconds: number,
): Promise<void> {
  const cost = (seconds / 3600) * RECALL_PER_HOUR_USD;
  try {
    const m = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { usageJson: true, costUsd: true },
    });
    if (!m) return;
    let rollup: UsageRollup = { entries: [] };
    if (m.usageJson) {
      try {
        rollup = JSON.parse(m.usageJson) as UsageRollup;
      } catch {}
    }
    rollup.recallSeconds = (rollup.recallSeconds ?? 0) + seconds;
    rollup.recallCostUsd = (rollup.recallCostUsd ?? 0) + cost;
    const newCost = (m.costUsd ?? 0) + cost;
    await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        usageJson: JSON.stringify(rollup),
        costUsd: newCost,
      },
    });
  } catch (err) {
    console.warn("[usage] recordRecallSeconds failed:", err);
  }
}
