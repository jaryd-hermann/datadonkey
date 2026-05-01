import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { analyzeTranscript } from "@/lib/anthropic";

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

  const followups = await analyzeTranscript(meeting.transcript);

  await prisma.meeting.update({
    where: { id },
    data: {
      followups: JSON.stringify(followups),
      followupsAt: new Date(),
    },
  });

  return NextResponse.json({ followups });
}
