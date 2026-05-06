import { prisma } from "./db";

// The DataDonkey pipeline is a small ordered set of stages users see in the
// big banner / per-meeting timeline. Stages move forward as work happens;
// terminal states are "done" or "failed".
export const PIPELINE_STAGES = [
  "listening",   // bot is in the call; transcript flowing in
  "reviewing",   // call ended; reading the transcript
  "analyzing",   // pulling out data questions
  "querying",    // calling the data tool MCP
  "delivering",  // composing + sending email/slack
  "done",        // delivered
  "failed",      // pipeline error
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export interface PipelineStageEntry {
  stage: PipelineStage;
  ts: number;
  ok?: boolean;
  detail?: string;
}

export const STAGE_LABELS: Record<PipelineStage, string> = {
  listening: "Listening",
  reviewing: "Reviewing meeting",
  analyzing: "Analyzing for data questions",
  querying: "Querying your data",
  delivering: "Delivering follow-up",
  done: "Delivered",
  failed: "Stopped",
};

// Retry up to 3 times against an OCC-style optimistic lock so concurrent
// setStage calls (e.g. bot-dispatch + first-transcript both setting
// "listening") don't lose updates by stomping on each other.
export async function setStage(
  meetingId: string,
  stage: PipelineStage,
  detail?: string,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const m = await prisma.meeting.findUnique({
        where: { id: meetingId },
        select: { pipelineStages: true, pipelineStageAt: true },
      });
      if (!m) return;
      let history: PipelineStageEntry[] = [];
      if (m.pipelineStages) {
        try {
          history = JSON.parse(m.pipelineStages) as PipelineStageEntry[];
        } catch {}
      }
      // Idempotency: if the same stage is being set again with no new detail,
      // don't append a duplicate row.
      const last = history[history.length - 1];
      if (last && last.stage === stage && !detail) return;
      // Mark previous stage as ok (it's complete now that we've moved on),
      // unless we're moving to a terminal failure state.
      if (last && last.ok === undefined && stage !== "failed") {
        last.ok = true;
      }
      history.push({ stage, ts: Date.now(), detail });
      const expectedAt = m.pipelineStageAt;
      const result = await prisma.meeting.updateMany({
        where: {
          id: meetingId,
          // OCC lock: only update if pipelineStageAt hasn't changed since we read.
          ...(expectedAt ? { pipelineStageAt: expectedAt } : { pipelineStageAt: null }),
        },
        data: {
          pipelineStage: stage,
          pipelineStageAt: new Date(),
          pipelineStages: JSON.stringify(history),
        },
      });
      if (result.count > 0) {
        console.log(`[pipeline] meeting=${meetingId} -> ${stage}${detail ? ` (${detail})` : ""}`);
        return;
      }
      // Lost the race; loop to retry against the latest state.
    } catch (err) {
      console.warn(`[pipeline] setStage attempt=${attempt} failed:`, err);
      // Try once more
    }
  }
  console.warn(`[pipeline] setStage gave up for meeting=${meetingId} stage=${stage}`);
}
