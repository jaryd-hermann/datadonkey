import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  analyzeTranscript,
  askDataToolStrategic,
  composeFollowupEmail,
  extractPostHogUrls,
  type FollowupQuestion,
} from "@/lib/anthropic";
import { readConnection } from "@/lib/connection";
import { sendFollowupEmail } from "@/lib/email";
import { dmAuthedUser, dmUserByEmail } from "@/lib/slack";

// Followup pipeline: 30-90s of MCP queries + Resend + Slack send.
// Vercel Hobby caps at 60s, Pro at 300s. We declare 300 here for headroom.
export const maxDuration = 300;

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const conn = await readConnection();
  if (!conn.connected) {
    return NextResponse.json(
      { error: "Data tool not connected" },
      { status: 400 },
    );
  }
  if (!meeting.transcript || !meeting.transcript.trim()) {
    return NextResponse.json(
      { error: "no transcript yet — has anyone spoken in the call?" },
      { status: 400 },
    );
  }

  await prisma.meeting.update({ where: { id }, data: { followupAttempted: true } });

  // Step 1: identify questions worth answering
  const identified = await analyzeTranscript(meeting.transcript);

  if (identified.length === 0) {
    await prisma.meeting.update({
      where: { id },
      data: {
        followups: JSON.stringify([]),
        followupsAt: new Date(),
        emailSubject: null,
        emailDraft: null,
        emailDraftAt: new Date(),
        followupReport: null,
      },
    });
    return NextResponse.json({ followups: [], emailSubject: null, emailDraft: null });
  }

  // Step 2: strategic-analyst answer per question, in parallel.
  const answered: Array<FollowupQuestion & { mcpPrompt: string }> = await Promise.all(
    identified.map(async (q) => {
      try {
        const result = await askDataToolStrategic(
          q.question,
          q.reasoning,
          conn.provider,
          conn.credentials,
        );
        return {
          question: q.question,
          reasoning: q.reasoning,
          answer: result.answer || "(no response)",
          posthogUrls: extractPostHogUrls(result.answer),
          mcpPrompt: JSON.stringify(result.prompt),
        };
      } catch (err) {
        console.error("[followup] askDataToolStrategic failed:", err);
        return {
          question: q.question,
          reasoning: q.reasoning,
          answer: `(${conn.provider.name} query failed)`,
          posthogUrls: [],
          mcpPrompt: "",
        };
      }
    }),
  );

  // Persist a Question row per item — including the prompt sent (for evals).
  // Wipe previous to keep things clean if Generate is re-run.
  await prisma.question.deleteMany({
    where: { meetingId: id, askerName: "DataDonkey" },
  });
  await prisma.question.createMany({
    data: answered.map((a) => ({
      meetingId: id,
      askerName: "DataDonkey",
      question: a.question,
      mcpPrompt: a.mcpPrompt,
      answer: a.answer ?? "",
    })),
  });

  // Step 3: parse participants
  let participants: Array<{ name: string; email?: string | null }> = [];
  if (meeting.participants) {
    try {
      participants = JSON.parse(meeting.participants);
    } catch {}
  }

  // Step 4: compose the email
  const email = await composeFollowupEmail({
    meetingTitle: meeting.title,
    participants,
    qa: answered.map((a) => ({
      question: a.question,
      reasoning: a.reasoning,
      answer: a.answer ?? "",
      posthogUrls: a.posthogUrls ?? [],
    })),
  });

  // Build a richer markdown report combining the email + per-question answers
  // with footnotes already inlined by the strategic analyst.
  const report = buildReportMarkdown({
    meetingTitle: meeting.title,
    headline: email.body,
    answered: answered.map((a) => ({
      question: a.question,
      reasoning: a.reasoning,
      answer: a.answer ?? "",
      posthogUrls: a.posthogUrls,
    })),
  });

  // Step 5: send to owner via Resend
  let emailedAt: Date | null = null;
  if (conn.userEmail) {
    const r = await sendFollowupEmail({
      to: conn.userEmail,
      subject: email.subject,
      markdown: report,
    });
    if (r.sent) emailedAt = new Date();
  }

  // Step 6: DM owner via Slack
  let slackedAt: Date | null = null;
  if (conn.slackConnected && conn.slackBotToken) {
    const slackText = `📊 Follow-up from "${meeting.title ?? "your meeting"}"\n\n${report}`;
    let slackRes: { sent: boolean; reason?: string } = { sent: false };
    if (conn.slackUserId) {
      slackRes = await dmAuthedUser({
        botToken: conn.slackBotToken,
        authedUserId: conn.slackUserId,
        text: slackText,
      });
    } else if (conn.userEmail) {
      slackRes = await dmUserByEmail({
        botToken: conn.slackBotToken,
        email: conn.userEmail,
        text: slackText,
      });
    }
    if (slackRes.sent) slackedAt = new Date();
  }

  await prisma.meeting.update({
    where: { id },
    data: {
      followups: JSON.stringify(
        answered.map(({ mcpPrompt: _mcpPrompt, ...rest }) => rest),
      ),
      followupsAt: new Date(),
      emailSubject: email.subject,
      emailDraft: email.body,
      emailDraftAt: new Date(),
      followupReport: report,
      followupEmailedAt: emailedAt,
      followupSlackedAt: slackedAt,
    },
  });

  return NextResponse.json({
    followups: answered,
    emailSubject: email.subject,
    emailDraft: email.body,
    followupReport: report,
    delivered: { email: !!emailedAt, slack: !!slackedAt },
  });
}

function buildReportMarkdown(args: {
  meetingTitle: string | null;
  headline: string;
  answered: Array<{
    question: string;
    reasoning: string;
    answer: string;
    posthogUrls?: string[];
  }>;
}): string {
  const head = `## Follow-up: ${args.meetingTitle ?? "your meeting"}\n\n${args.headline}\n\n---\n`;
  const body = args.answered
    .map(
      (a, i) =>
        `### ${i + 1}. ${a.question}\n\n_Why this came up:_ ${a.reasoning}\n\n${a.answer}\n`,
    )
    .join("\n");
  return head + body;
}
