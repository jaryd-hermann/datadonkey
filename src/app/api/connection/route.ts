import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { readConnection, saveCredentials, saveSignup } from "@/lib/connection";
import { getProvider, type ProviderId } from "@/lib/providers";
import { sendWelcomeEmail, addToResendAudience } from "@/lib/email";
import { requireUserId } from "@/lib/auth";

export async function GET() {
  const auth = await requireUserId();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const conn = await readConnection(userId);
  // Best-effort: surface PostHog org/project name for the connection card.
  let projectName: string | null = null;
  let organizationName: string | null = null;
  if (conn.connected && conn.provider.id === "posthog") {
    const apiKey = conn.credentials.apiKey;
    const projectId = conn.credentials.projectId;
    const host = conn.credentials.host || "https://us.posthog.com";
    if (apiKey && projectId) {
      try {
        const r = await fetch(`${host}/api/projects/${projectId}/`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          // 5s budget — never block dashboard load on PostHog
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) {
          const j = (await r.json()) as {
            name?: string;
            organization?: { name?: string };
          };
          projectName = j.name ?? null;
          organizationName = j.organization?.name ?? null;
        }
      } catch {
        // fall through with nulls
      }
    }
  }
  // Pull additional flat fields directly so we don't need to thread them
  // through ConnectionView: role, orgSize, isPartner.
  const row = await prisma.connection.findUnique({ where: { userId } });
  return NextResponse.json({
    exists: conn.exists,
    signedUp: conn.signedUp,
    connected: conn.connected,
    userName: conn.userName,
    userCompany: conn.userCompany,
    userEmail: conn.userEmail,
    userRole: row?.userRole ?? null,
    orgSize: row?.orgSize ?? null,
    isPartner: row?.isPartner ?? false,
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
    projectName,
    organizationName,
    prefLive: conn.prefLive,
    prefFollowup: conn.prefFollowup,
    calendarConnected: conn.calendarConnected,
    calendarProvider: conn.calendarProvider,
    calendarAutojoinPolicy: conn.calendarAutojoinPolicy,
    slackConnected: conn.slackConnected,
    slackTeamName: conn.slackTeamName,
  });
}

// Partial update of preferences + mock OAuth state (calendar / slack).
export async function PATCH(req: NextRequest) {
  const auth = await requireUserId();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json().catch(() => ({}));
  const update: Record<string, string | boolean | null> = {};

  if (typeof body.prefLive === "boolean") update.prefLive = body.prefLive;
  if (typeof body.prefFollowup === "boolean") update.prefFollowup = body.prefFollowup;
  if (typeof body.calendarConnected === "boolean") update.calendarConnected = body.calendarConnected;
  if (typeof body.calendarProvider === "string" || body.calendarProvider === null) {
    update.calendarProvider = body.calendarProvider;
  }
  if (
    typeof body.calendarAutojoinPolicy === "string" &&
    ["all", "host_only", "off"].includes(body.calendarAutojoinPolicy)
  ) {
    update.calendarAutojoinPolicy = body.calendarAutojoinPolicy;
  }
  if (typeof body.slackConnected === "boolean") update.slackConnected = body.slackConnected;
  if (typeof body.slackTeamName === "string" || body.slackTeamName === null) {
    update.slackTeamName = body.slackTeamName;
  }
  if (typeof body.userRole === "string" || body.userRole === null) {
    update.userRole = body.userRole;
  }
  if (typeof body.orgSize === "string" || body.orgSize === null) {
    update.orgSize = body.orgSize;
  }
  if (typeof body.isPartner === "boolean") update.isPartner = body.isPartner;
  if (typeof body.partnerCodeUsed === "string") {
    update.partnerCodeUsed = body.partnerCodeUsed;
  }

  // Enforce: at least one preference must be enabled.
  if (update.prefLive === false || update.prefFollowup === false) {
    const cur = await prisma.connection.findUnique({ where: { userId } });
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
    where: { userId },
    create: { userId, ...update },
    update,
  });
  return NextResponse.json({ ok: true });
}

// Signup: stores name/company/email/provider keyed to the Supabase user id.
export async function POST(req: NextRequest) {
  const auth = await requireUserId();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = await req.json().catch(() => ({}));
  const userName = String(body?.userName ?? "").trim();
  const userCompany = String(body?.userCompany ?? "").trim();
  const userEmail = body?.userEmail ? String(body.userEmail).trim() : undefined;
  const userRole = body?.userRole ? String(body.userRole).trim() : undefined;
  const orgSize = body?.orgSize ? String(body.orgSize).trim() : undefined;
  const provider = String(body?.provider ?? "posthog") as ProviderId;
  if (!userName || !userCompany) {
    return NextResponse.json(
      { error: "userName and userCompany required" },
      { status: 400 },
    );
  }
  // Detect first-time signup so we can fire the welcome email exactly once.
  const before = await prisma.connection.findUnique({ where: { userId } });
  const wasNew = !before?.welcomeEmailedAt;
  await saveSignup({ userId, userName, userCompany, userEmail, provider });
  if (userRole || orgSize) {
    await prisma.connection.update({
      where: { userId },
      data: {
        ...(userRole ? { userRole } : {}),
        ...(orgSize ? { orgSize } : {}),
      },
    });
  }

  if (wasNew && userEmail) {
    after(async () => {
      try {
        const r = await sendWelcomeEmail({ to: userEmail, name: userName });
        if (r.sent) {
          await prisma.connection.update({
            where: { userId },
            data: { welcomeEmailedAt: new Date() },
          });
        }
        // Best-effort audience add (broadcast list)
        await addToResendAudience({ email: userEmail, name: userName });
      } catch (err) {
        console.error("[signup] lifecycle email failed:", err);
      }
    });
  }
  return NextResponse.json({ ok: true });
}

// Save credentials for the chosen provider. Validates via a tool-specific
// probe when possible; we only do this for PostHog right now.
export async function PUT(req: NextRequest) {
  const auth = await requireUserId();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

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

  await saveCredentials(userId, providerId, credentials);
  return NextResponse.json({ ok: true });
}

// Disconnect the data source: clear credentials + OAuth tokens. Leaves the
// signup info (name, company, etc.) and other tool connections (Slack, calendar)
// intact so the user only loses the data tool wiring.
export async function DELETE() {
  const auth = await requireUserId();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  await prisma.connection.update({
    where: { userId },
    data: {
      credentials: null,
      posthogOauthAccessToken: null,
      posthogOauthRefreshToken: null,
      posthogOauthExpiresAt: null,
      posthogOauthRegion: null,
      posthogOauthScopes: null,
    },
  });
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
