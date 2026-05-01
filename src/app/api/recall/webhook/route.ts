import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { askPostHog } from "@/lib/anthropic";
import { sendChatMessage } from "@/lib/recall";
import { detectWakeWord } from "@/lib/wakeword";
import { appendUtterance, debounce, shouldThrottle } from "@/lib/transcripts";

// Recall sends real-time events here (transcripts + bot status). We must
// respond quickly (<1s); slow work happens in fire-and-forget async tasks.

interface RecallEvent {
  event: string;
  data: {
    bot?: { id: string };
    transcript?: {
      participant?: { id?: number; name?: string | null; is_host?: boolean };
      words?: Array<{ text: string }>;
    };
    status?: { code?: string };
    // Some payload shapes nest the new status code under different keys; keep
    // the type loose so we can read whichever field arrives.
    [k: string]: unknown;
  };
}

const WELCOMED = new Set<string>();

const WELCOME_MSG =
  `👋 Hi, I'm PostHog. Say "Hey PostHog, …" and I'll look up data for you.\n` +
  `Try: "Hey PostHog, how many users this week?" or "what dashboards do we have?"\n` +
  `(tip: turn on captions in your meeting so I can hear you)`;

const ACK_NO_QUESTION =
  `👋 listening — what's the data question? e.g. "Hey PostHog, how many active users today?"`;

export async function POST(req: NextRequest) {
  let payload: RecallEvent;
  try {
    payload = (await req.json()) as RecallEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const event = payload.event;
  const botId = payload.data?.bot?.id;
  if (!event || !botId) {
    console.log("[webhook] missing event/bot id; keys:", Object.keys(payload?.data ?? {}));
    return NextResponse.json({ ok: true });
  }

  if (event !== "transcript.data") {
    console.log(`[webhook] ${event} bot=${botId}`);
    return NextResponse.json({ ok: true });
  }

  // First time we see any transcript chunk for this bot, send the welcome
  // message. (Recall's bot.status_change events aren't allowed on realtime
  // endpoints, so this is the cheapest reliable trigger.)
  if (!WELCOMED.has(botId)) {
    WELCOMED.add(botId);
    void sendChatMessage(botId, WELCOME_MSG);
    console.log(`[webhook] bot=${botId} welcomed`);
  }

  // Final transcript chunk
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

  const match = detectWakeWord(text);
  if (!match) return NextResponse.json({ ok: true });

  if (shouldThrottle(botId)) {
    console.log(`[webhook] bot=${botId} throttled`);
    return NextResponse.json({ ok: true });
  }

  // No follow-up question — just acknowledge so the user knows we heard them.
  if (match.question.length < 3) {
    void sendChatMessage(botId, ACK_NO_QUESTION);
    return NextResponse.json({ ok: true });
  }

  // Debounce briefly so a long sentence finishes before we fire the LLM call.
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

  // Stall: ack + "looking that up" in a single message.
  void sendChatMessage(botId, "👀 looking that up…");

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
