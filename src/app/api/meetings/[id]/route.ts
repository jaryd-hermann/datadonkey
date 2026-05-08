import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireUserId();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const { id } = await ctx.params;
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { questions: { orderBy: { createdAt: "asc" } } },
  });
  if (!meeting || meeting.userId !== userId) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const safeJson = <T>(s: string | null, fallback: T): T => {
    if (!s) return fallback;
    try {
      return JSON.parse(s) as T;
    } catch {
      return fallback;
    }
  };

  const participants = safeJson<Array<{ name: string; email?: string | null }>>(
    meeting.participants,
    [],
  );
  const followups = safeJson<
    Array<{
      question: string;
      reasoning: string;
      answer?: string;
      posthogUrls?: string[];
    }>
  >(meeting.followups, []);

  return NextResponse.json({
    meeting: {
      ...meeting,
      participants,
      followups,
    },
  });
}
