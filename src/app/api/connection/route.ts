import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readConnection, saveCredentials, saveSignup } from "@/lib/connection";
import { getProvider, type ProviderId } from "@/lib/providers";

export async function GET() {
  const conn = await readConnection();
  return NextResponse.json({
    exists: conn.exists,
    signedUp: conn.signedUp,
    connected: conn.connected,
    userName: conn.userName,
    userCompany: conn.userCompany,
    userEmail: conn.userEmail,
    provider: {
      id: conn.provider.id,
      name: conn.provider.name,
      available: conn.provider.available,
      hasOAuth: conn.provider.hasOAuth,
      oauthLabel: conn.provider.oauthLabel,
      credentialFields: conn.provider.credentialFields,
      setupHint: conn.provider.setupHint,
    },
    credentials: redactCredentials(conn.credentials),
    prefLive: conn.prefLive,
    prefFollowup: conn.prefFollowup,
    calendarConnected: conn.calendarConnected,
    calendarProvider: conn.calendarProvider,
    slackConnected: conn.slackConnected,
    slackTeamName: conn.slackTeamName,
  });
}

// Partial update of preferences + mock OAuth state (calendar / slack).
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const update: Record<string, string | boolean | null> = {};

  if (typeof body.prefLive === "boolean") update.prefLive = body.prefLive;
  if (typeof body.prefFollowup === "boolean") update.prefFollowup = body.prefFollowup;
  if (typeof body.calendarConnected === "boolean") update.calendarConnected = body.calendarConnected;
  if (typeof body.calendarProvider === "string" || body.calendarProvider === null) {
    update.calendarProvider = body.calendarProvider;
  }
  if (typeof body.slackConnected === "boolean") update.slackConnected = body.slackConnected;
  if (typeof body.slackTeamName === "string" || body.slackTeamName === null) {
    update.slackTeamName = body.slackTeamName;
  }

  // Enforce: at least one preference must be enabled.
  if (update.prefLive === false || update.prefFollowup === false) {
    const cur = await prisma.connection.findUnique({ where: { id: "default" } });
    const live = update.prefLive !== undefined ? Boolean(update.prefLive) : (cur?.prefLive ?? true);
    const fu = update.prefFollowup !== undefined ? Boolean(update.prefFollowup) : (cur?.prefFollowup ?? true);
    if (!live && !fu) {
      return NextResponse.json(
        { error: "At least one preference must be enabled" },
        { status: 400 },
      );
    }
  }

  await prisma.connection.upsert({
    where: { id: "default" },
    create: { id: "default", ...update },
    update,
  });
  return NextResponse.json({ ok: true });
}

// Mock signup: stores name/company/email/provider. No real auth.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const userName = String(body?.userName ?? "").trim();
  const userCompany = String(body?.userCompany ?? "").trim();
  const userEmail = body?.userEmail ? String(body.userEmail).trim() : undefined;
  const provider = String(body?.provider ?? "posthog") as ProviderId;
  if (!userName || !userCompany) {
    return NextResponse.json(
      { error: "userName and userCompany required" },
      { status: 400 },
    );
  }
  await saveSignup({ userName, userCompany, userEmail, provider });
  return NextResponse.json({ ok: true });
}

// Save credentials for the chosen provider. Validates via a tool-specific
// probe when possible; we only do this for PostHog right now.
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const providerId = String(body?.provider ?? "posthog") as ProviderId;
  const provider = getProvider(providerId);
  const incoming = (body?.credentials ?? {}) as Record<string, string>;

  // Pull only fields the provider declares
  const credentials: Record<string, string> = {};
  for (const f of provider.credentialFields) {
    const v = incoming[f.key];
    if (typeof v === "string" && v.length > 0) credentials[f.key] = v;
  }

  // Validation per provider
  if (provider.id === "posthog") {
    const apiKey = credentials.apiKey;
    const projectId = credentials.projectId;
    const host = credentials.host || "https://us.posthog.com";
    if (!apiKey || !projectId) {
      return NextResponse.json(
        { error: "apiKey and projectId required" },
        { status: 400 },
      );
    }
    const res = await fetch(`${host}/api/projects/${projectId}/`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `PostHog validation failed (${res.status}): ${text.slice(0, 200)}` },
        { status: 400 },
      );
    }
    credentials.host = host;
  }
  // Mixpanel/Amplitude: no live MCP yet, just save.

  await saveCredentials(providerId, credentials);
  return NextResponse.json({ ok: true });
}

function redactCredentials(c: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) {
    if (typeof v !== "string") continue;
    if (k === "host" || k === "projectId") {
      out[k] = v;
    } else {
      // Mask secrets but show last 4 chars so the UI can confirm it's saved.
      out[k] = v.length > 6 ? `••••${v.slice(-4)}` : "•••";
    }
  }
  return out;
}
