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

export async function setStage(
  meetingId: string,
  stage: PipelineStage,
  detail?: string,
): Promise<void> {
  try {
    const m = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!m) return;
    let history: PipelineStageEntry[] = [];
    if (m.pipelineStages) {
      try {
        history = JSON.parse(m.pipelineStages) as PipelineStageEntry[];
      } catch {}
    }
    // Mark previous stage as ok (it's complete now that we've moved on),
    // unless we're moving to a terminal failure state.
    const prev = history[history.length - 1];
    if (prev && prev.ok === undefined && stage !== "failed") {
      prev.ok = true;
    }
    history.push({ stage, ts: Date.now(), detail });
    await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        pipelineStage: stage,
        pipelineStageAt: new Date(),
        pipelineStages: JSON.stringify(history),
      },
    });
  } catch (err) {
    console.warn("[pipeline] setStage failed:", err);
  }
}
