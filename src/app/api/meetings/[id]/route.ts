import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { questions: { orderBy: { createdAt: "asc" } } },
  });
  if (!meeting) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let participants: Array<{ name: string; email?: string | null }> = [];
  if (meeting.participants) {
    try {
      participants = JSON.parse(meeting.participants);
    } catch {
      // ignore
    }
  }
  let followups: Array<{ question: string; reasoning: string }> = [];
  if (meeting.followups) {
    try {
      followups = JSON.parse(meeting.followups);
    } catch {
      // ignore
    }
  }

  return NextResponse.json({
    meeting: {
      ...meeting,
      participants,
      followups,
    },
  });
}
