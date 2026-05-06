import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const REGION = process.env.RECALL_REGION ?? "us-west-2";
const BASE_URL = `https://${REGION}.recall.ai`;

// POST /api/recall/bot/:id/leave — id is our internal Meeting id (not Recall's bot id).
// Tells Recall to make the bot leave the call. We mark the meeting as done locally
// so the dashboard reflects the action immediately.
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const meeting = await prisma.meeting.findUnique({ where: { id } });
  if (!meeting) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const key = process.env.RECALL_API_KEY;
  if (key) {
    try {
      const r = await fetch(`${BASE_URL}/api/v1/bot/${meeting.recallBotId}/leave_call/`, {
        method: "POST",
        headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        console.warn("[leave] Recall returned", r.status, await r.text());
      }
    } catch (err) {
      console.warn("[leave] Recall call failed:", err);
    }
  }
  await prisma.meeting.update({
    where: { id },
    data: { status: "done", endedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
