import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { askPostHog } from "@/lib/anthropic";
import { sendChatMessage } from "@/lib/recall";
import { detectWakeWord } from "@/lib/wakeword";
import { appendUtterance, debounce, shouldThrottle } from "@/lib/transcripts";

// Recall sends real-time transcript events here. We must respond quickly
// (<1s); long-running work happens in fire-and-forget async tasks.

interface RecallTranscriptEvent {
  event: string;
  data: {
    bot?: { id: string };
    transcript?: {
      participant?: { id?: number; name?: string | null; is_host?: boolean };
      words?: Array<{ text: string; start_timestamp?: { absolute?: string } }>;
    };
  };
}

export async function POST(req: NextRequest) {
  let payload: RecallTranscriptEvent;
  try {
    payload = (await req.json()) as RecallTranscriptEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const event = payload.event;
  const botId = payload.data?.bot?.id;
  if (!event || !botId) {
    console.log("[webhook] missing event or bot id; payload keys:", Object.keys(payload ?? {}));
    return NextResponse.json({ ok: true });
  }

  // We only care about finalized transcript chunks for wake-word detection.
  // Partial events arrive too rapidly and would trigger false positives.
  if (event !== "transcript.data") {
    if (event !== "transcript.partial_data") {
      console.log(`[webhook] ${event} bot=${botId}`);
    }
    return NextResponse.json({ ok: true });
  }

  const words = payload.data.transcript?.words ?? [];
  const text = words
    .map((w) => w.text)
    .join(" ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
  const speaker = payload.data.transcript?.participant?.name ?? null;

  if (!text) return NextResponse.json({ ok: true });

  console.log(`[webhook] bot=${botId} speaker=${speaker} text="${text}"`);

  appendUtterance(botId, { speaker, text, ts: Date.now() });

  // Match the wake word against the latest utterance only. Matching against
  // a rolling buffer would re-trigger off prior wake phrases.
  const match = detectWakeWord(text);
  if (!match) return NextResponse.json({ ok: true });

  if (shouldThrottle(botId)) {
    console.log(`[webhook] bot=${botId} throttled, skipping`);
    return NextResponse.json({ ok: true });
  }

  // Debounce by 1.2s — wait for the speaker to finish their sentence before
  // firing the LLM call.
  debounce(botId, 1_200, () => {
    void handleQuestion(botId, match.question, speaker);
  });

  return NextResponse.json({ ok: true });
}

async function handleQuestion(botId: string, question: string, speaker: string | null) {
  const t0 = Date.now();
  console.log(`[wake] bot=${botId} q="${question}"`);

  const meeting = await prisma.meeting.findUnique({ where: { recallBotId: botId } });
  const conn = await prisma.connection.findUnique({ where: { id: "default" } });
  if (!meeting || !conn) {
    console.error(`[wake] no meeting or connection for bot=${botId}`);
    return;
  }

  // Stall message (fire and forget — keeps the meeting feeling responsive)
  void sendChatMessage(botId, "Looking that up…");

  let answer: string;
  try {
    const result = await askPostHog(
      question,
      conn.posthogApiKey,
      conn.posthogProjectId,
      conn.posthogHost,
    );
    answer = result.answer || "(no response)";
  } catch (err) {
    console.error(`[wake] askPostHog failed:`, err);
    answer = "Sorry, I hit an error querying PostHog.";
  }

  await sendChatMessage(botId, answer);
  await prisma.question.create({
    data: {
      meetingId: meeting.id,
      askerName: speaker,
      question,
      answer,
      latencyMs: Date.now() - t0,
    },
  });
  console.log(`[wake] bot=${botId} answered in ${Date.now() - t0}ms`);
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST Recall webhooks here" });
}
