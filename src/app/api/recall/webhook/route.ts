import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { askDataTool } from "@/lib/anthropic";
import { sendChatMessage } from "@/lib/recall";
import { detectWakeWord } from "@/lib/wakeword";
import { readConnection } from "@/lib/connection";

// Stateless webhook handler designed for Vercel:
// - All cross-request state (welcome dedup, armed, throttle, conversation) is
//   on the Meeting row, not in process memory.
// - Long async work (sendChatMessage + askDataTool) is run via `after()`
//   so the webhook response returns fast (Recall expects <1s), but the
//   work is preserved by the platform until completion.
// - Recall account-level webhooks deliver `bot.status_change` events to
//   this same endpoint; we use them to update Meeting.status and trigger
//   the auto-followup pipeline when a call ends.

export const maxDuration = 60;

interface RecallEvent {
  event: string;
  data: {
    bot?: { id: string };
    data?: Record<string, unknown>;
    transcript?: Record<string, unknown>;
    [k: string]: unknown;
  };
}

const TRIGGER_COOLDOWN_MS = 4_000;
const ARM_WINDOW_MS = 12_000;
const MAX_HISTORY_MESSAGES = 8; // 4 Q&A pairs
const HISTORY_TTL_MS = 5 * 60_000;
const TERMINAL_CODES = new Set(["done", "fatal", "call_ended"]);
const IN_CALL_CODES = new Set(["in_call_recording", "in_call_not_recording"]);

interface ConversationTurn { role: "user" | "assistant"; content: string; ts: number }

function welcomeMessage(brand: string, prefLive: boolean, prefFollowup: boolean): string {
  const lines = [`👋 Hi, I'm DataDonkey, your data analyst.`];
  if (prefLive) {
    lines.push(`Say "Hey ${brand}, …" clearly and I'll answer in chat. Try: "Hey ${brand}, how many users this week?"`);
  }
  if (prefFollowup) {
    lines.push(`After this call, I'll send you a follow-up with any data points worth knowing.`);
  }
  if (!process.env.DEEPGRAM_API_KEY) {
    lines.push(`(tip: turn on captions in your meeting so I can hear you)`);
  }
  return lines.join("\n");
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
    return NextResponse.json({ ok: true });
  }

  // Recall account-level webhooks fire one event per state (bot.joining_call,
  // bot.in_call_recording, bot.done, bot.call_ended, …). Old API also has a
  // unified bot.status_change event — handle both.
  if (event.startsWith("bot.") && event !== "bot.created") {
    const code = event === "bot.status_change"
      ? extractCode(payload)
      : event.slice("bot.".length);
    await handleStatusChange(botId, code);
    console.log(`[webhook] ${event} bot=${botId} -> ${code}`);
    return NextResponse.json({ ok: true });
  }

  if (event !== "transcript.data") {
    console.log(`[webhook] ${event} bot=${botId} (ignored)`);
    return NextResponse.json({ ok: true });
  }

  const conn = await readConnection();
  const provider = conn.provider;

  // First time we see any transcript chunk for this bot, send the welcome.
  // Welcome state is persisted on Meeting.welcomed so this is safe across
  // serverless invocations.
  const meeting = await prisma.meeting.findUnique({
    where: { recallBotId: botId },
  });
  if (!meeting) {
    return NextResponse.json({ ok: true });
  }
  if (!meeting.welcomed) {
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { welcomed: true, status: meeting.status === "joining" ? "in_call" : meeting.status },
    });
    after(async () => {
      try {
        await sendChatMessage(
          botId,
          welcomeMessage(provider.name, conn.prefLive, conn.prefFollowup),
        );
      } catch (e) {
        console.error("[webhook] welcome failed:", e);
      }
    });
  }

  // Recall's transcript.data payload is double-nested.
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
    typeof participant?.name === "string" ? (participant.name as string) : null;

  if (!text) return NextResponse.json({ ok: true });

  console.log(`[webhook] bot=${botId} speaker=${speaker} text="${text}"`);

  // Persist the utterance immediately (transcript + participants).
  await persistUtterance(meeting.id, speaker, text);

  if (!conn.prefLive) {
    // Live Q&A is off — we're only buffering the transcript for follow-up.
    return NextResponse.json({ ok: true });
  }

  const match = detectWakeWord(text, provider);
  const now = new Date();
  const fresh = await prisma.meeting.findUnique({ where: { id: meeting.id } });
  if (!fresh) return NextResponse.json({ ok: true });
  const armed = fresh.armedUntil ? fresh.armedUntil.getTime() > now.getTime() : false;
  const throttled = fresh.lastTriggerAt
    ? now.getTime() - fresh.lastTriggerAt.getTime() < TRIGGER_COOLDOWN_MS
    : false;

  // Path 1: wake word in this utterance
  if (match) {
    if (throttled) {
      console.log(`[webhook] bot=${botId} throttled`);
      return NextResponse.json({ ok: true });
    }
    if (match.question.length < 3) {
      await prisma.meeting.update({
        where: { id: meeting.id },
        data: { armedUntil: new Date(now.getTime() + ARM_WINDOW_MS) },
      });
      after(async () => {
        try { await sendChatMessage(botId, ackNoQuestion(provider.name)); } catch {}
      });
      return NextResponse.json({ ok: true });
    }
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { armedUntil: null, lastTriggerAt: now },
    });
    after(() => handleQuestion(botId, meeting.id, match.question, speaker));
    return NextResponse.json({ ok: true });
  }

  // Path 2: armed -> treat this utterance as the question
  if (armed) {
    if (throttled) return NextResponse.json({ ok: true });
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { armedUntil: null, lastTriggerAt: now },
    });
    after(() => handleQuestion(botId, meeting.id, text, speaker));
  }

  return NextResponse.json({ ok: true });
}

async function persistUtterance(
  meetingId: string,
  speaker: string | null,
  text: string,
) {
  try {
    const m = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!m) return;
    const line = `${speaker ?? "?"}: ${text}`;
    const transcript = m.transcript ? `${m.transcript}\n${line}` : line;

    let participants: Array<{ name: string; email?: string | null }> = [];
    if (m.participants) {
      try { participants = JSON.parse(m.participants); } catch {}
    }
    if (speaker && !participants.some((p) => p.name === speaker)) {
      participants.push({ name: speaker });
    }
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { transcript, participants: JSON.stringify(participants) },
    });
  } catch (err) {
    console.error("[webhook] persistUtterance failed:", err);
  }
}

async function handleQuestion(
  botId: string,
  meetingId: string,
  question: string,
  speaker: string | null,
) {
  const t0 = Date.now();
  console.log(`[wake] bot=${botId} q="${question}"`);

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId } });
  const conn = await readConnection();
  if (!meeting || !conn.exists) return;

  try { await sendChatMessage(botId, "👀 looking that up…"); } catch {}

  const history = readHistory(meeting.conversation);
  let answer: string;
  try {
    const result = await askDataTool(
      question,
      conn.provider,
      conn.credentials,
      history.map(({ role, content }) => ({ role, content })),
    );
    answer = result.answer || "(no response)";
  } catch (err) {
    console.error("[wake] askDataTool failed:", err);
    answer = `Sorry, I hit an error querying ${conn.provider.name}.`;
  }

  try { await sendChatMessage(botId, answer); } catch {}

  const newHistory = appendTurns(history, [
    { role: "user", content: question, ts: Date.now() },
    { role: "assistant", content: answer, ts: Date.now() },
  ]);
  await prisma.meeting.update({
    where: { id: meeting.id },
    data: { conversation: JSON.stringify(newHistory) },
  });
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

function readHistory(json: string | null): ConversationTurn[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as ConversationTurn[];
    const cutoff = Date.now() - HISTORY_TTL_MS;
    return parsed.filter((t) => (t.ts ?? 0) >= cutoff);
  } catch {
    return [];
  }
}

function appendTurns(prev: ConversationTurn[], next: ConversationTurn[]) {
  const combined = [...prev, ...next];
  return combined.slice(-MAX_HISTORY_MESSAGES);
}

function extractCode(payload: RecallEvent): string | undefined {
  const inner = payload.data;
  if (typeof (inner.code as string | undefined) === "string") {
    return inner.code as string;
  }
  const status = inner.status as Record<string, unknown> | undefined;
  if (status && typeof status.code === "string") return status.code as string;
  return undefined;
}

async function handleStatusChange(botId: string, code: string | undefined) {
  if (!code) return;

  const friendly = IN_CALL_CODES.has(code)
    ? "in_call"
    : TERMINAL_CODES.has(code)
      ? "done"
      : code;

  const meeting = await prisma.meeting.findUnique({ where: { recallBotId: botId } });
  if (!meeting) return;

  await prisma.meeting.update({
    where: { id: meeting.id },
    data: {
      status: friendly,
      ...(TERMINAL_CODES.has(code) ? { endedAt: new Date() } : {}),
    },
  });

  if (TERMINAL_CODES.has(code)) {
    after(() => triggerAutoFollowup(meeting.id));
  }
}

async function triggerAutoFollowup(meetingId: string) {
  try {
    // Give Recall a moment to flush any final transcript chunks.
    await new Promise((r) => setTimeout(r, 8_000));
    const conn = await prisma.connection.findUnique({ where: { id: "default" } });
    if (!conn?.prefFollowup) return;
    const m = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!m || m.followupAttempted) return;
    if (!m.transcript || !m.transcript.trim()) return;
    const origin = process.env.APP_URL ?? "http://localhost:3000";
    const r = await fetch(`${origin}/api/meetings/${meetingId}/followup`, { method: "POST" });
    if (!r.ok) console.warn("[auto-followup] failed", await r.text());
  } catch (err) {
    console.error("[auto-followup] error:", err);
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST Recall webhooks here" });
}
