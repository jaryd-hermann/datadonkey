import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { createBot } from "@/lib/recall";
import { readConnection } from "@/lib/connection";
import { sendFirstCallEmail } from "@/lib/email";
import { dmAuthedUser, dmUserByEmail } from "@/lib/slack";

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

  // Lifecycle: first-call email + Slack "I'm joining" DM. Fire-and-forget.
  after(async () => {
    try {
      const fresh = await prisma.connection.findUnique({ where: { id: "default" } });
      if (!fresh) return;
      const isFirstCall = !fresh.firstCallEmailedAt;
      const platform = detectPlatform(meetingUrl);
      const meetingLabel = platform === "unknown" ? "your meeting" : `your ${platform} call`;

      // Slack DM (every call)
      if (fresh.slackBotToken) {
        const text = `Hey, I'm in ${meetingLabel} just chilling. Don't mind me — I'll follow up with some of your data if relevant!`;
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
            where: { id: "default" },
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
  const meetings = await prisma.meeting.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { questions: { orderBy: { createdAt: "desc" } } },
  });
  return NextResponse.json({ meetings });
}
