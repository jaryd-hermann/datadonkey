import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireUserId } from "@/lib/auth";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireUserId();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const { id } = await ctx.params;
  // updateMany with userId filter scopes ownership without race window
  await prisma.meeting.updateMany({
    where: { id, userId },
    data: { pipelineDismissed: true },
  });
  return NextResponse.json({ ok: true });
}
