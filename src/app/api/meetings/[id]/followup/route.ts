import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  analyzeTranscript,
  askPostHog,
  composeFollowupEmail,
  extractPostHogUrls,
  type FollowupQuestion,
} from "@/lib/anthropic";

// Full pipeline: identify questions in transcript -> answer each via PostHog
// MCP -> compose a follow-up email draft. Saves everything back to the
// Meeting row. Blocking call (~30-60s).

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!meeting.transcript || !meeting.transcript.trim()) {
    return NextResponse.json(
      { error: "transcript not available yet" },
      { status: 400 },
    );
  }
  const conn = await prisma.connection.findUnique({ where: { id: "default" } });
  if (!conn) {
    return NextResponse.json(
      { error: "PostHog not connected" },
      { status: 400 },
    );
  }

  // Step 1: identify questions
  const identified = await analyzeTranscript(meeting.transcript);

  // No data questions worth asking — save empty state and return early.
  if (identified.length === 0) {
    await prisma.meeting.update({
      where: { id },
      data: {
        followups: JSON.stringify([]),
        followupsAt: new Date(),
        emailSubject: null,
        emailDraft: null,
        emailDraftAt: new Date(),
      },
    });
    return NextResponse.json({ followups: [], emailSubject: null, emailDraft: null });
  }

  // Step 2: answer each question via PostHog MCP, in parallel.
  const answered: FollowupQuestion[] = await Promise.all(
    identified.map(async (q) => {
      try {
        const result = await askPostHog(
          q.question,
          conn.posthogApiKey,
          conn.posthogProjectId,
          conn.posthogHost,
        );
        return {
          question: q.question,
          reasoning: q.reasoning,
          answer: result.answer || "(no response)",
          posthogUrls: extractPostHogUrls(result.answer),
        };
      } catch (err) {
        console.error("[followup] askPostHog failed:", err);
        return {
          question: q.question,
          reasoning: q.reasoning,
          answer: "(PostHog query failed)",
          posthogUrls: [],
        };
      }
    }),
  );

  // Step 3: compose the email.
  let participants: Array<{ name: string; email?: string | null }> = [];
  if (meeting.participants) {
    try {
      participants = JSON.parse(meeting.participants);
    } catch {
      // ignore
    }
  }

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

  await prisma.meeting.update({
    where: { id },
    data: {
      followups: JSON.stringify(answered),
      followupsAt: new Date(),
      emailSubject: email.subject,
      emailDraft: email.body,
      emailDraftAt: new Date(),
    },
  });

  return NextResponse.json({
    followups: answered,
    emailSubject: email.subject,
    emailDraft: email.body,
  });
}
