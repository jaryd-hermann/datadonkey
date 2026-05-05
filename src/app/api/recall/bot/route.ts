import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createBot } from "@/lib/recall";
import { readConnection } from "@/lib/connection";

// Dispatcher: creates the Recall bot and persists a Meeting row. Status
// changes and the auto-followup pipeline are driven by Recall account-level
// webhooks (bot.status_change) -> /api/recall/webhook, so this route can run
// fully on Vercel's serverless runtime without keeping a poll loop alive.

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
      botName: conn.provider.name,
    });
  } catch (err) {
    console.error("[bot] createBot failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  const meeting = await prisma.meeting.create({
    data: { recallBotId: bot.id, meetingUrl, status: "joining" },
  });

  return NextResponse.json({ ok: true, meeting, bot });
}

export async function GET() {
  const meetings = await prisma.meeting.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { questions: { orderBy: { createdAt: "desc" } } },
  });
  return NextResponse.json({ meetings });
}
