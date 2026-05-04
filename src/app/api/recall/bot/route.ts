import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createBot, getBot, sendChatMessage } from "@/lib/recall";
import { readConnection } from "@/lib/connection";
import { isWelcomed, markWelcomed } from "@/lib/welcome";

export async function POST(req: NextRequest) {
  const conn = await readConnection();
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
      botName: conn.provider.name, // shows as e.g. "PostHog" / "Mixpanel" in the call
    });
  } catch (err) {
    console.error("[bot] createBot failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  const meeting = await prisma.meeting.create({
    data: { recallBotId: bot.id, meetingUrl, status: "joining" },
  });

  // Fire-and-forget: poll bot status, send welcome on join, and keep
  // updating Meeting.status as Recall reports state changes. Caps at 4
  // hours so a stuck process doesn't hold a watcher forever.
  void watchBot(bot.id, conn.provider.name);

  return NextResponse.json({ ok: true, meeting, bot });
}

const TERMINAL_STATES = new Set(["done", "fatal", "call_ended"]);
const IN_CALL_STATES = new Set(["in_call_recording", "in_call_not_recording"]);

async function watchBot(botId: string, providerName: string) {
  const deadline = Date.now() + 4 * 60 * 60 * 1000;
  let lastSeen: string | null = null;

  while (Date.now() < deadline) {
    let latest: string | undefined;
    try {
      const b = (await getBot(botId)) as Record<string, unknown>;
      const changes = (b.status_changes as Array<{ code?: string }> | undefined) ?? [];
      latest = changes[changes.length - 1]?.code;
    } catch {
      // transient — try again
    }

    if (latest && latest !== lastSeen) {
      lastSeen = latest;
      // Persist a friendly status onto the Meeting row so the dashboard
      // can show "in a call" / "snoozing".
      const friendly = IN_CALL_STATES.has(latest)
        ? "in_call"
        : TERMINAL_STATES.has(latest)
          ? "done"
          : latest;
      try {
        await prisma.meeting.update({
          where: { recallBotId: botId },
          data: {
            status: friendly,
            ...(TERMINAL_STATES.has(latest) ? { endedAt: new Date() } : {}),
          },
        });
      } catch {
        // ignore
      }

      // Welcome the moment we first see in-call.
      if (IN_CALL_STATES.has(latest) && !isWelcomed(botId)) {
        markWelcomed(botId);
        const msg =
          `👋 Hi, I'm DataDonkey, your data analyst. Say "Hey ${providerName}, …" and I'll look up data for you.\n` +
          `Try: "Hey ${providerName}, how many users this week?" or "what dashboards do we have?"`;
        await sendChatMessage(botId, msg);
      }
    }

    if (latest && TERMINAL_STATES.has(latest)) return;

    await new Promise((r) => setTimeout(r, 5_000));
  }
}

export async function GET() {
  const meetings = await prisma.meeting.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { questions: { orderBy: { createdAt: "desc" } } },
  });
  return NextResponse.json({ meetings });
}
