import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  analyzeTranscript,
  askDataToolStrategic,
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

  const tStart = Date.now();
  console.log(`[followup] START meeting=${id} transcript=${meeting.transcript.length}c`);
  await prisma.meeting.update({ where: { id }, data: { followupAttempted: true } });

  // Step 1: identify questions worth answering
  const identified = await analyzeTranscript(meeting.transcript);
  console.log(`[followup] analyzed in ${Date.now() - tStart}ms -> ${identified.length} questions`);

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

  // Step 2: strategic-analyst answer per question. Sequential (not parallel)
  // for two reasons: (1) avoid Anthropic rate limits on concurrent
  // mcp_servers calls, (2) Vercel Hobby caps function execution at 60s, so
  // we'd rather get 1-2 great answers than time out 3 mediocre ones.
  // Cap to the first 2 questions to comfortably fit in Vercel Hobby's 60s
  // function cap. On Pro (300s) we could safely raise this to 5+.
  const QUESTION_BUDGET = 2;
  const queue = identified.slice(0, QUESTION_BUDGET);
  const skipped = identified.slice(QUESTION_BUDGET);
  const answered: Array<FollowupQuestion & { mcpPrompt: string }> = [];
  for (const q of queue) {
    const t0 = Date.now();
    try {
      const result = await askDataToolStrategic(
        q.question,
        q.reasoning,
        conn.provider,
        conn.credentials,
      );
      console.log(
        `[followup] q="${q.question.slice(0, 60)}" ${Date.now() - t0}ms tools=${result.toolCalls.length} tok=${result.usage.outputTokens}`,
      );
      answered.push({
        question: q.question,
        reasoning: q.reasoning,
        answer: result.answer || "(empty response from the model)",
        posthogUrls: extractPostHogUrls(result.answer),
        mcpPrompt: JSON.stringify(result.prompt),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[followup] askDataToolStrategic threw for "${q.question}":`, msg);
      answered.push({
        question: q.question,
        reasoning: q.reasoning,
        answer: `_Couldn't answer this one — ${conn.provider.name} query errored: ${msg.slice(0, 200)}_`,
        posthogUrls: [],
        mcpPrompt: "",
      });
    }
  }
  // Note skipped questions in the report rather than dropping them silently.
  for (const s of skipped) {
    answered.push({
      question: s.question,
      reasoning: s.reasoning,
      answer: `_Skipped to keep the analysis under 60s — re-run "Generate" to answer this one._`,
      posthogUrls: [],
      mcpPrompt: "",
    });
  }

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

  // Step 4: build the report markdown directly from the answers (each
  // already has BLUF + findings + footnotes from the strategic analyst).
  // We deliberately skip a separate compose-email LLM call to stay under
  // Vercel Hobby's 60s function cap.
  const titleStr = meeting.title ?? "your meeting";
  const subject = `DataDonkey follow-up: ${titleStr}`;
  const report = buildReportMarkdown({
    meetingTitle: meeting.title,
    answered: answered.map((a) => ({
      question: a.question,
      reasoning: a.reasoning,
      answer: a.answer ?? "",
      posthogUrls: a.posthogUrls,
    })),
  });

  // Step 5: send to owner via Resend
  let emailedAt: Date | null = null;
  let emailReason: string | undefined;
  if (conn.userEmail) {
    const r = await sendFollowupEmail({ to: conn.userEmail, subject, markdown: report });
    if (r.sent) emailedAt = new Date();
    else emailReason = r.reason;
    console.log(`[followup] email to=${conn.userEmail} sent=${r.sent} reason=${r.reason ?? "-"}`);
  } else {
    console.log("[followup] no userEmail on connection — skipping email");
  }

  // Step 6: DM owner via Slack
  let slackedAt: Date | null = null;
  if (conn.slackConnected && conn.slackBotToken) {
    const slackText = `📊 Follow-up from "${meeting.title ?? "your meeting"}"\n\n${report}`;
    let slackRes: { sent: boolean; reason?: string } = { sent: false, reason: "no_target" };
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
    console.log(`[followup] slack sent=${slackRes.sent} reason=${slackRes.reason ?? "-"}`);
  } else {
    console.log(`[followup] slack skipped — connected=${conn.slackConnected} hasToken=${!!conn.slackBotToken}`);
  }

  await prisma.meeting.update({
    where: { id },
    data: {
      followups: JSON.stringify(
        answered.map(({ mcpPrompt: _mcpPrompt, ...rest }) => rest),
      ),
      followupsAt: new Date(),
      emailSubject: subject,
      emailDraft: report,
      emailDraftAt: new Date(),
      followupReport: report,
      followupEmailedAt: emailedAt,
      followupSlackedAt: slackedAt,
    },
  });

  console.log(
    `[followup] DONE meeting=${id} total=${Date.now() - tStart}ms email=${!!emailedAt} slack=${!!slackedAt}`,
  );
  return NextResponse.json({
    followups: answered,
    emailSubject: subject,
    emailDraft: report,
    followupReport: report,
    delivered: { email: !!emailedAt, slack: !!slackedAt, emailReason },
  });
}

function buildReportMarkdown(args: {
  meetingTitle: string | null;
  answered: Array<{
    question: string;
    reasoning: string;
    answer: string;
    posthogUrls?: string[];
  }>;
}): string {
  const head = `## Follow-up: ${args.meetingTitle ?? "your meeting"}\n\n`;
  const body = args.answered
    .map(
      (a, i) =>
        `### ${i + 1}. ${a.question}\n\n_Why this came up:_ ${a.reasoning}\n\n${a.answer}\n`,
    )
    .join("\n");
  return head + body;
}
