import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { askDataTool } from "@/lib/anthropic";
import { readConnection } from "@/lib/connection";
import { verifySlackSignature, postSlackMessage } from "@/lib/slack";

// Conversational Slackbot: anyone in the workspace can DM the bot or @mention
// it in a channel to ask data questions. We route the message text through the
// existing askDataTool() MCP path and post the answer as a thread reply.
//
// Slack expects 200 within 3s — we ack immediately and run the LLM call via
// `after()`. Retries (x-slack-retry-num) are dropped to avoid double answers.

export const maxDuration = 60;

interface SlackEventEnvelope {
  type: "url_verification" | "event_callback";
  challenge?: string;
  event_id?: string;
  team_id?: string;
  event?: SlackInnerEvent;
}

interface SlackInnerEvent {
  type: string; // "app_mention" | "message"
  channel_type?: string; // "im" for DMs
  user?: string;
  bot_id?: string;
  channel?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  subtype?: string; // "message_changed", "bot_message", etc — we skip these
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Drop Slack retries — we can be slow (LLM call) and don't want duplicates
  const retryNum = req.headers.get("x-slack-retry-num");
  if (retryNum) {
    return NextResponse.json({ ok: true });
  }

  // Signature verification (skip in dev if signing secret missing)
  const ts = req.headers.get("x-slack-request-timestamp");
  const sig = req.headers.get("x-slack-signature");
  if (process.env.SLACK_SIGNING_SECRET) {
    if (!verifySlackSignature(rawBody, ts, sig)) {
      console.warn("[slack-events] bad signature");
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  let payload: SlackEventEnvelope;
  try {
    payload = JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Slack URL handshake
  if (payload.type === "url_verification" && payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge });
  }

  if (payload.type !== "event_callback" || !payload.event) {
    return NextResponse.json({ ok: true });
  }

  const ev = payload.event;

  // Only react to: @mention OR direct message (im) — not channel chatter
  const isMention = ev.type === "app_mention";
  const isDM = ev.type === "message" && ev.channel_type === "im";
  if (!isMention && !isDM) {
    return NextResponse.json({ ok: true });
  }

  // Don't loop on our own messages or other bots
  if (ev.bot_id || ev.subtype === "bot_message" || ev.subtype === "message_changed") {
    return NextResponse.json({ ok: true });
  }

  // Look up the right user's connection by Slack workspace id. If multiple
  // users in the same workspace installed DataDonkey, we pick the most recent.
  if (!payload.team_id) {
    return NextResponse.json({ ok: true });
  }
  const connRow = await prisma.connection.findFirst({
    where: {
      slackTeamId: payload.team_id,
      slackConnected: true,
      slackBotToken: { not: null },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!connRow) {
    return NextResponse.json({ ok: true });
  }
  // Skip messages from our own bot user
  if (ev.user && connRow.slackBotUserId && ev.user === connRow.slackBotUserId) {
    return NextResponse.json({ ok: true });
  }

  // Strip @bot mention from the text
  const cleanText = (ev.text ?? "").replace(/<@[A-Z0-9]+>\s*/g, "").trim();
  if (!cleanText) {
    return NextResponse.json({ ok: true });
  }

  const channel = ev.channel ?? "";
  // Reply in the same thread (or start one off the original message)
  const threadTs = ev.thread_ts ?? ev.ts;

  // Ack within 3s — process the actual question after returning
  after(() =>
    handleSlackMessage(channel, threadTs, cleanText, connRow.slackBotToken!, connRow.userId),
  );

  return NextResponse.json({ ok: true });
}

async function handleSlackMessage(
  channel: string,
  threadTs: string | undefined,
  text: string,
  botToken: string,
  userId: string,
) {
  const t0 = Date.now();
  try {
    const conn = await readConnection(userId);
    if (!conn.connected) {
      await postSlackMessage({
        botToken,
        channel,
        threadTs,
        text:
          "I'm not connected to a data tool yet. Have your DataDonkey admin connect PostHog at https://datadonkey.ai/dashboard.",
      });
      return;
    }

    // Quick "thinking" reaction-style ack so the user knows we got it
    await postSlackMessage({
      botToken,
      channel,
      threadTs,
      text: ":mag: looking that up…",
    });

    // Pull thread history if we're in a thread to keep context across follow-ups
    const history = await readSlackThreadHistory(botToken, channel, threadTs, text);

    const result = await askDataTool(text, conn.provider, conn.credentials, history);
    const answer = result.answer || "(no response)";

    await postSlackMessage({ botToken, channel, threadTs, text: answer });

    // Persist for future audit / evals
    try {
      await prisma.question.create({
        data: {
          // We don't have a Meeting in this path — write to a synthetic one
          // bound to the Slack thread so foreign-key holds. Easier: skip
          // persistence since it's optional.
          meetingId: "",
          askerName: "slack",
          question: text,
          answer,
          mcpPrompt: result.prompt.system,
          latencyMs: Date.now() - t0,
        },
      });
    } catch {
      // expected — meetingId FK not satisfied. Skip silently.
    }
  } catch (err) {
    console.error("[slack-events] handle failed:", err);
    await postSlackMessage({
      botToken,
      channel,
      threadTs,
      text: "Hit an error querying your data. Have your admin check the DataDonkey logs.",
    });
  }
}

interface SlackHistoryReply {
  user?: string;
  bot_id?: string;
  text?: string;
}

async function readSlackThreadHistory(
  botToken: string,
  channel: string,
  threadTs: string | undefined,
  excludeLatest: string,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  if (!threadTs || !channel) return [];
  try {
    const r = await fetch("https://slack.com/api/conversations.replies", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ channel, ts: threadTs, limit: "10" }),
    });
    const j = (await r.json()) as { ok?: boolean; messages?: SlackHistoryReply[] };
    if (!j.ok || !Array.isArray(j.messages)) return [];
    const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const m of j.messages) {
      const t = (m.text ?? "").replace(/<@[A-Z0-9]+>\s*/g, "").trim();
      if (!t) continue;
      // Skip the message we're currently answering
      if (t === excludeLatest) continue;
      // Skip our own ack messages
      if (t.startsWith(":mag:")) continue;
      turns.push({ role: m.bot_id ? "assistant" : "user", content: t });
    }
    return turns.slice(-6); // last 3 Q&A pairs
  } catch (err) {
    console.error("[slack-events] history fetch failed:", err);
    return [];
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST Slack events here" });
}
