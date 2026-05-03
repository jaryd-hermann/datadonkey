import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { askDataTool } from "@/lib/anthropic";
import { sendChatMessage } from "@/lib/recall";
import { detectWakeWord } from "@/lib/wakeword";
import {
  appendUtterance,
  arm,
  debounce,
  disarm,
  isArmed,
  shouldThrottle,
} from "@/lib/transcripts";
import { appendTurn, getHistory } from "@/lib/conversations";
import { readConnection } from "@/lib/connection";

// Recall sends real-time events here (transcripts + bot status). We must
// respond quickly (<1s); slow work happens in fire-and-forget async tasks.

interface RecallEvent {
  event: string;
  data: {
    bot?: { id: string };
    // Recall's transcript.data event nests the actual words + participant
    // info under data.data, with data.transcript holding metadata only.
    data?: Record<string, unknown>;
    transcript?: Record<string, unknown>;
    [k: string]: unknown;
  };
}

import { isWelcomed, markWelcomed } from "@/lib/welcome";

function welcomeMessage(brand: string): string {
  return (
    `👋 Hi, I'm DataDonkey, your data analyst. Say "Hey ${brand}, …" clearly and I'll look up data for you.\n` +
    `Try: "Hey ${brand}, how many users this week?" or "what dashboards do we have?"` +
    (process.env.DEEPGRAM_API_KEY
      ? ""
      : `\n(tip: turn on captions in your meeting so I can hear you)`)
  );
}

function ackNoQuestion(brand: string): string {
  return `👋 listening — what's the data question? e.g. "Hey ${brand}, how many active users today?"`;
}

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

  const conn = await readConnection();
  const provider = conn.provider;

  // First time we see any transcript chunk for this bot, send the welcome
  // message. (Recall's bot.status_change events aren't allowed on realtime
  // endpoints, so this is the cheapest reliable trigger.)
  if (!isWelcomed(botId)) {
    markWelcomed(botId);
    void sendChatMessage(botId, welcomeMessage(provider.name));
    console.log(`[webhook] bot=${botId} welcomed (${provider.name})`);
  }

  // Recall's transcript.data payload is double-nested: data.data holds the
  // words + participant, while data.transcript is just metadata.
  const inner = (payload.data.data ?? payload.data.transcript) as
    | Record<string, unknown>
    | undefined;
  const words = (inner?.words as Array<{ text?: string }> | undefined) ?? [];
  const text = words
    .map((w) => w.text ?? "")
    .join(" ")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
  const participant = inner?.participant as Record<string, unknown> | undefined;
  const speaker =
    (typeof participant?.name === "string" ? (participant.name as string) : null) ??
    null;

  if (!text) return NextResponse.json({ ok: true });

  console.log(`[webhook] bot=${botId} speaker=${speaker} text="${text}"`);
  appendUtterance(botId, { speaker, text, ts: Date.now() });

  // Persist to DB as we go so the meeting detail page can show a live
  // transcript without depending on Recall's post-call /transcript endpoint.
  void persistUtterance(botId, speaker, text);

  const match = detectWakeWord(text, provider);

  // Path 1: wake word detected in this utterance
  if (match) {
    if (shouldThrottle(botId)) {
      console.log(`[webhook] bot=${botId} throttled`);
      return NextResponse.json({ ok: true });
    }

    if (match.question.length < 3) {
      // Just the wake word, no question yet. Ack and wait for the next
      // utterance to be the question.
      arm(botId);
      void sendChatMessage(botId, ackNoQuestion(provider.name));
      console.log(`[webhook] bot=${botId} armed (wake word, no question)`);
      return NextResponse.json({ ok: true });
    }

    // Wake word + question in one utterance — fire after a short debounce.
    disarm(botId);
    debounce(botId, 1_200, () => {
      void handleQuestion(botId, match.question, speaker);
    });
    return NextResponse.json({ ok: true });
  }

  // Path 2: no wake word, but the bot is armed (we heard wake word in a
  // recent prior utterance). Treat this utterance as the question.
  if (isArmed(botId)) {
    disarm(botId);
    if (shouldThrottle(botId)) return NextResponse.json({ ok: true });
    console.log(`[webhook] bot=${botId} armed-question="${text}"`);
    debounce(botId, 1_200, () => {
      void handleQuestion(botId, text, speaker);
    });
  }

  return NextResponse.json({ ok: true });
}

async function persistUtterance(
  botId: string,
  speaker: string | null,
  text: string,
) {
  try {
    const meeting = await prisma.meeting.findUnique({
      where: { recallBotId: botId },
    });
    if (!meeting) return;

    const line = `${speaker ?? "?"}: ${text}`;
    const transcript = meeting.transcript ? `${meeting.transcript}\n${line}` : line;

    let participants: Array<{ name: string; email?: string | null }> = [];
    if (meeting.participants) {
      try {
        participants = JSON.parse(meeting.participants);
      } catch {
        // ignore
      }
    }
    if (speaker && !participants.some((p) => p.name === speaker)) {
      participants.push({ name: speaker });
    }

    await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        transcript,
        participants: JSON.stringify(participants),
      },
    });
  } catch (err) {
    console.error("[webhook] persistUtterance failed:", err);
  }
}

async function handleQuestion(botId: string, question: string, speaker: string | null) {
  const t0 = Date.now();
  console.log(`[wake] bot=${botId} q="${question}"`);

  const meeting = await prisma.meeting.findUnique({ where: { recallBotId: botId } });
  const conn = await readConnection();
  if (!meeting || !conn.exists) {
    console.error(`[wake] no meeting or connection for bot=${botId}`);
    return;
  }

  // Stall: ack + "looking that up" in a single message.
  void sendChatMessage(botId, "👀 looking that up…");

  const history = getHistory(botId);
  let answer: string;
  try {
    const result = await askDataTool(
      question,
      conn.provider,
      conn.credentials,
      history,
    );
    answer = result.answer || "(no response)";
  } catch (err) {
    console.error(`[wake] askDataTool failed:`, err);
    answer = `Sorry, I hit an error querying ${conn.provider.name}.`;
  }

  await sendChatMessage(botId, answer);
  // Save this turn so a follow-up "Hey PostHog" within 5min has context.
  appendTurn(botId, "user", question);
  appendTurn(botId, "assistant", answer);
  await prisma.question.create({
    data: {
      meetingId: meeting.id,
      askerName: speaker,
      question,
      answer,
      latencyMs: Date.now() - t0,
    },
  });
  console.log(`[wake] bot=${botId} answered in ${Date.now() - t0}ms (history=${history.length} turns)`);
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST Recall webhooks here" });
}
