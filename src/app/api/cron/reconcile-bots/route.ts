import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { getBot } from "@/lib/recall";

// Reconcile non-terminal Meeting rows against Recall's bot status. Belt-and-
// suspenders for when Recall's account-level webhook for bot.status_change
// is missing or misconfigured. Runs every minute.
//
// We bound batch size so a single tick can't blow past Vercel's function
// duration limit on a backlog of stale meetings.

export const maxDuration = 60;

const TERMINAL = new Set(["done", "fatal", "call_ended"]);
const IN_CALL = new Set(["in_call_recording", "in_call_not_recording"]);

export async function GET() {
  const stale = await prisma.meeting.findMany({
    where: {
      status: { notIn: ["done", "fatal", "call_ended"] },
      endedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  const results: { id: string; from: string; to: string }[] = [];
  for (const m of stale) {
    try {
      const raw = (await getBot(m.recallBotId)) as Record<string, unknown>;
      const code = pickLatestCode(raw);
      if (!code) continue;
      const friendly = IN_CALL.has(code)
        ? "in_call"
        : TERMINAL.has(code)
          ? "done"
          : code;
      if (friendly === m.status) continue;
      await prisma.meeting.update({
        where: { id: m.id },
        data: {
          status: friendly,
          ...(TERMINAL.has(code) && !m.endedAt ? { endedAt: new Date() } : {}),
        },
      });
      results.push({ id: m.id, from: m.status, to: friendly });
      if (TERMINAL.has(code) && !m.followupAttempted) {
        after(() => triggerAutoFollowup(m.id));
      }
    } catch (err) {
      console.warn("[reconcile-bots] failed", m.recallBotId, err);
    }
  }

  return NextResponse.json({ ok: true, reconciled: results });
}

function pickLatestCode(bot: Record<string, unknown>): string | undefined {
  const direct = (bot.status as Record<string, unknown> | undefined)?.code as
    | string
    | undefined;
  if (typeof direct === "string") return direct;
  const arr = bot.status_changes as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(arr) && arr.length) {
    const last = arr[arr.length - 1];
    if (typeof last.code === "string") return last.code as string;
  }
  return undefined;
}

async function triggerAutoFollowup(meetingId: string) {
  try {
    await new Promise((r) => setTimeout(r, 8_000));
    const conn = await prisma.connection.findUnique({ where: { id: "default" } });
    if (!conn?.prefFollowup) return;
    const m = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!m || m.followupAttempted) return;
    if (!m.transcript || !m.transcript.trim()) return;
    const origin = process.env.APP_URL ?? "http://localhost:3000";
    await fetch(`${origin}/api/meetings/${meetingId}/followup`, { method: "POST" });
  } catch (err) {
    console.error("[reconcile-bots] auto-followup error:", err);
  }
}
