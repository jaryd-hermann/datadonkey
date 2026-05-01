import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const apiKey: string | undefined = body?.apiKey;
  const projectId: string | undefined = body?.projectId;
  const host: string = body?.host ?? "https://us.posthog.com";

  if (!apiKey || !projectId) {
    return NextResponse.json(
      { error: "apiKey and projectId required" },
      { status: 400 },
    );
  }

  // Validate the key against the PostHog project endpoint.
  const validateRes = await fetch(`${host}/api/projects/${projectId}/`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!validateRes.ok) {
    const text = await validateRes.text();
    return NextResponse.json(
      { error: `Validation failed (${validateRes.status}): ${text.slice(0, 200)}` },
      { status: 400 },
    );
  }

  const conn = await prisma.connection.upsert({
    where: { id: "default" },
    create: { id: "default", posthogApiKey: apiKey, posthogProjectId: projectId, posthogHost: host },
    update: { posthogApiKey: apiKey, posthogProjectId: projectId, posthogHost: host },
  });

  return NextResponse.json({
    ok: true,
    projectId: conn.posthogProjectId,
    host: conn.posthogHost,
  });
}

export async function GET() {
  const conn = await prisma.connection.findUnique({ where: { id: "default" } });
  if (!conn) return NextResponse.json({ connected: false });
  return NextResponse.json({
    connected: true,
    projectId: conn.posthogProjectId,
    host: conn.posthogHost,
  });
}
