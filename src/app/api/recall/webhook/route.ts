import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { askPostHog } from "@/lib/anthropic";
import {
  sendChatMessage,
  getBot,
  getTranscriptLines,
  extractParticipants,
} from "@/lib/recall";
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

  if (event === "bot.status_change") {
    handleStatusChange(botId, payload);
    return NextResponse.json({ ok: true });
  }

  if (event !== "transcript.data") {
    console.log(`[webhook] ${event} bot=${botId}`);
    return NextResponse.json({ ok: true });
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

function handleStatusChange(botId: string, payload: RecallEvent) {
  // The status code can land under data.status.code or data.code depending on
  // the Recall payload version; try both.
  const code =
    payload.data?.status?.code ??
    (typeof payload.data?.code === "string" ? (payload.data.code as string) : undefined);
  console.log(`[status] bot=${botId} code=${code}`);

  if (!code) return;

  void prisma.meeting
    .update({ where: { recallBotId: botId }, data: { status: code } })
    .catch(() => {});

  // Send the welcome message the first time the bot is fully in the call.
  const inCall = code === "in_call_recording" || code === "in_call_not_recording";
  if (inCall && !WELCOMED.has(botId)) {
    WELCOMED.add(botId);
    void sendChatMessage(botId, WELCOME_MSG);
    console.log(`[status] bot=${botId} welcomed`);
  }

  // Fetch + persist the canonical transcript when the bot wraps up.
  if (code === "done" || code === "call_ended") {
    void persistFinalTranscript(botId);
  }
}

async function persistFinalTranscript(botId: string) {
  try {
    const [bot, lines] = await Promise.all([
      getBot(botId).catch((err) => {
        console.error(`[final] getBot failed:`, err);
        return null;
      }),
      getTranscriptLines(botId).catch((err) => {
        console.error(`[final] getTranscriptLines failed:`, err);
        return [];
      }),
    ]);

    const participants = bot ? extractParticipants(bot) : [];
    const formatted = lines
      .map((l) => `${l.speaker ?? "?"}: ${l.text}`)
      .join("\n");

    // Fall back to inferring participants from the transcript if Recall didn't
    // give us a list (common when the bot was dispatched ad-hoc with no
    // calendar event).
    if (participants.length === 0) {
      const seen = new Set<string>();
      for (const l of lines) {
        if (l.speaker && !seen.has(l.speaker)) {
          seen.add(l.speaker);
          participants.push({ name: l.speaker });
        }
      }
    }

    const title =
      (bot as Record<string, unknown> | null)?.["meeting_metadata"] != null
        ? ((bot as Record<string, unknown>).meeting_metadata as Record<string, unknown>)?.title as string | undefined
        : undefined;

    await prisma.meeting.update({
      where: { recallBotId: botId },
      data: {
        endedAt: new Date(),
        transcript: formatted,
        participants: JSON.stringify(participants),
        title: title ?? null,
      },
    });
    console.log(`[final] bot=${botId} transcript=${formatted.length}b participants=${participants.length}`);
  } catch (err) {
    console.error(`[final] persistFinalTranscript failed:`, err);
  }
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
