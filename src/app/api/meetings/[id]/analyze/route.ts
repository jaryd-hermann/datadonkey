import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { analyzeTranscript } from "@/lib/anthropic";
import { requireUserId } from "@/lib/auth";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireUserId();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const { id } = await ctx.params;
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting || meeting.userId !== userId) {
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
