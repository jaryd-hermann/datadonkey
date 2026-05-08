import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { createBot, getBot } from "@/lib/recall";
import { readConnection } from "@/lib/connection";
import { sendFirstCallEmail } from "@/lib/email";
import { dmAuthedUser, dmUserByEmail } from "@/lib/slack";
import { setStage } from "@/lib/pipeline";
import { requireUserId } from "@/lib/auth";

// Dispatcher: creates the Recall bot and persists a Meeting row. Status
// changes and the auto-followup pipeline are driven by Recall account-level
// webhooks (bot.status_change) -> /api/recall/webhook, so this route can run
// fully on Vercel's serverless runtime without keeping a poll loop alive.

export async function POST(req: NextRequest) {
  const auth = await requireUserId();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const conn = await readConnection(userId);
  if (!conn.connected) {
    return NextResponse.json(
      { error: "Connect a data tool first." },
      { status: 400 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const meetingUrl: string | undefined = body?.meetingUrl;
  if (!meetingUrl) {
    return NextResponse.json({ error: "meetingUrl required" }, { status: 400 });
  }

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const webhookUrl = `${appUrl}/api/recall/webhook`;

  let bot;
  try {
    bot = await createBot({
      meetingUrl,
      webhookUrl,
      botName: conn.provider.name,
    });
  } catch (err) {
    console.error("[bot] createBot failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  const meeting = await prisma.meeting.create({
    data: { userId, recallBotId: bot.id, meetingUrl, status: "joining" },
  });
  await setStage(meeting.id, "listening", "bot dispatched, waiting to join");

  // Lifecycle: first-call email + Slack "I'm joining" DM. Fire-and-forget.
  after(async () => {
    try {
      const fresh = await prisma.connection.findUnique({ where: { userId } });
      if (!fresh) return;
      const isFirstCall = !fresh.firstCallEmailedAt;
      const platform = detectPlatform(meetingUrl);
      const meetingLabel = platform === "unknown" ? "your meeting" : `your ${platform} call`;

      // Slack DM (every call) — owner gets a heads-up that the bot is in.
      if (fresh.slackBotToken) {
        const owner = fresh.userCompany?.trim() || "your team";
        const text = `Hey — I'm in ${meetingLabel} as ${owner}'s ${conn.provider.name} instance. Just listening; I'll follow up after with any data points worth knowing.`;
        if (fresh.slackUserId) {
          await dmAuthedUser({
            botToken: fresh.slackBotToken,
            authedUserId: fresh.slackUserId,
            text,
          });
        } else if (fresh.userEmail) {
          await dmUserByEmail({ botToken: fresh.slackBotToken, email: fresh.userEmail, text });
        }
      }

      // First-call email (once per account)
      if (isFirstCall && fresh.userEmail) {
        const r = await sendFirstCallEmail({
          to: fresh.userEmail,
          name: fresh.userName ?? "",
          meetingUrl,
        });
        if (r.sent) {
          await prisma.connection.update({
            where: { userId },
            data: { firstCallEmailedAt: new Date() },
          });
        }
      }
    } catch (err) {
      console.error("[bot] lifecycle hook failed:", err);
    }
  });

  return NextResponse.json({ ok: true, meeting, bot });
}

function detectPlatform(url: string): "Zoom" | "Teams" | "Meet" | "unknown" {
  if (!url) return "unknown";
  if (/zoom\.us\/|zoomgov\.com\//i.test(url)) return "Zoom";
  if (/teams\.microsoft\.com\/|teams\.live\.com\//i.test(url)) return "Teams";
  if (/meet\.google\.com\//i.test(url)) return "Meet";
  return "unknown";
}

export async function GET() {
  const auth = await requireUserId();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  // Reconcile any non-terminal meetings against Recall so stale "Live" rows
  // don't sit forever when an account-level webhook isn't delivering. We
  // bound this to ~5 lookups per page-load to keep latency reasonable.
  const stale = await prisma.meeting.findMany({
    where: {
      userId,
      status: { notIn: ["done", "fatal", "call_ended"] },
      endedAt: null,
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  await Promise.all(stale.map((m) => reconcileStatus(m.id, m.recallBotId, m.userId)));

  const meetings = await prisma.meeting.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { questions: { orderBy: { createdAt: "desc" } } },
  });
  return NextResponse.json({ meetings });
}

const TERMINAL = new Set(["done", "fatal", "call_ended"]);
const IN_CALL = new Set(["in_call_recording", "in_call_not_recording"]);

async function reconcileStatus(meetingId: string, botId: string, ownerId: string) {
  try {
    const raw = (await getBot(botId)) as Record<string, unknown>;
    const code = pickLatestCode(raw);
    if (!code) return;
    const friendly = IN_CALL.has(code)
      ? "in_call"
      : TERMINAL.has(code)
        ? "done"
        : code;
    const m = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!m) return;
    if (m.status === friendly) return;
    await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        status: friendly,
        ...(TERMINAL.has(code) && !m.endedAt ? { endedAt: new Date() } : {}),
      },
    });
    if (TERMINAL.has(code) && !m.followupAttempted) {
      after(() => triggerAutoFollowup(meetingId, ownerId));
    }
  } catch (err) {
    console.warn("[reconcile] failed for", botId, err);
  }
}

function pickLatestCode(bot: Record<string, unknown>): string | undefined {
  const direct = (bot.status as Record<string, unknown> | undefined)?.code as
    | string
    | undefined;
  if (typeof direct === "string") return direct;
  // status_changes array — last entry is most recent
  const arr = bot.status_changes as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(arr) && arr.length) {
    const last = arr[arr.length - 1];
    if (typeof last.code === "string") return last.code as string;
  }
  return undefined;
}

async function triggerAutoFollowup(meetingId: string, ownerId: string) {
  try {
    await new Promise((r) => setTimeout(r, 8_000));
    const conn = await prisma.connection.findUnique({ where: { userId: ownerId } });
    if (!conn?.prefFollowup) return;
    const m = await prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!m || m.followupAttempted) return;
    if (!m.transcript || !m.transcript.trim()) return;
    const origin = process.env.APP_URL ?? "http://localhost:3000";
    const r = await fetch(`${origin}/api/meetings/${meetingId}/followup`, { method: "POST" });
    if (!r.ok) console.warn("[reconcile] auto-followup failed:", await r.text());
  } catch (err) {
    console.error("[reconcile] auto-followup error:", err);
  }
}
