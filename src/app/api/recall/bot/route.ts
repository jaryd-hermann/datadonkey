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

  // Fire-and-forget: poll bot status and send the welcome message the
  // instant the bot is in-call. We can't subscribe to bot.status_change
  // events on realtime_endpoints, so polling is the cheapest reliable way
  // to make the welcome appear immediately on join.
  void waitAndWelcome(bot.id, conn.provider.name);

  return NextResponse.json({ ok: true, meeting, bot });
}

async function waitAndWelcome(botId: string, providerName: string) {
  const deadline = Date.now() + 90_000; // give up after 90s
  while (Date.now() < deadline) {
    if (isWelcomed(botId)) return; // webhook beat us to it
    try {
      const b = (await getBot(botId)) as Record<string, unknown>;
      const changes = (b.status_changes as Array<{ code?: string }> | undefined) ?? [];
      const latest = changes[changes.length - 1]?.code;
      if (latest === "in_call_recording" || latest === "in_call_not_recording") {
        if (!isWelcomed(botId)) {
          markWelcomed(botId);
          const msg =
            `👋 Hi, I'm DataDonkey, your data analyst. Say "Hey ${providerName}, …" and I'll look up data for you.\n` +
            `Try: "Hey ${providerName}, how many users this week?" or "what dashboards do we have?"`;
          await sendChatMessage(botId, msg);
        }
        return;
      }
      if (latest === "fatal" || latest === "done") return;
    } catch {
      // ignore transient errors and keep polling
    }
    await new Promise((r) => setTimeout(r, 2_000));
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
