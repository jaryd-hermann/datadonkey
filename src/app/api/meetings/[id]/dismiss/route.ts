import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  await prisma.meeting.update({
    where: { id },
    data: { pipelineDismissed: true },
  });
  return NextResponse.json({ ok: true });
}
