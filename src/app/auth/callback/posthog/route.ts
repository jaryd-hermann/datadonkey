import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  discoverFirstProject,
  exchangeCode,
  getMe,
  REGION_API_HOST,
  type PosthogRegion,
} from "@/lib/posthog-oauth";
import { getCurrentUserId } from "@/lib/auth";

// GET /auth/callback/posthog?code=…&state=…
// Validates state, swaps code for tokens, fetches user identity + first
// scoped project, persists everything to the Connection row.

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");

  const ret = req.cookies.get("ph_oauth_return")?.value ?? "/onboarding/connect";
  const savedState = req.cookies.get("ph_oauth_state")?.value;
  const savedVerifier = req.cookies.get("ph_oauth_verifier")?.value;
  const region = (req.cookies.get("ph_oauth_region")?.value ?? "us") as PosthogRegion;

  // Helper: clear oauth cookies on the response
  function clearCookies(res: NextResponse) {
    for (const name of ["ph_oauth_state", "ph_oauth_verifier", "ph_oauth_region", "ph_oauth_return"]) {
      res.cookies.delete(name);
    }
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    const target = new URL(ret, url);
    target.searchParams.set("posthog_oauth_error", "not_signed_in");
    const res = NextResponse.redirect(target);
    clearCookies(res);
    return res;
  }

  if (errorParam) {
    const target = new URL(ret, url);
    target.searchParams.set("posthog_oauth_error", errorDesc ?? errorParam);
    const res = NextResponse.redirect(target);
    clearCookies(res);
    return res;
  }

  if (!code || !returnedState || !savedState || returnedState !== savedState) {
    const target = new URL(ret, url);
    target.searchParams.set("posthog_oauth_error", "state_mismatch");
    const res = NextResponse.redirect(target);
    clearCookies(res);
    return res;
  }
  if (!savedVerifier) {
    const target = new URL(ret, url);
    target.searchParams.set("posthog_oauth_error", "missing_verifier");
    const res = NextResponse.redirect(target);
    clearCookies(res);
    return res;
  }

  let tokens;
  try {
    tokens = await exchangeCode({ code, codeVerifier: savedVerifier });
  } catch (err) {
    console.error("[posthog-oauth] exchange failed:", err);
    const target = new URL(ret, url);
    target.searchParams.set(
      "posthog_oauth_error",
      err instanceof Error ? err.message.slice(0, 200) : "exchange_failed",
    );
    const res = NextResponse.redirect(target);
    clearCookies(res);
    return res;
  }

  // Discover identity + first project so the user doesn't need to type a
  // project ID after OAuth.
  const [me, project] = await Promise.all([
    getMe(tokens.access_token, region).catch(() => null),
    discoverFirstProject(tokens.access_token, region).catch(() => null),
  ]);

  // Existing PAT-style credentials live in `credentials` JSON. We keep them
  // for backward compatibility but the OAuth columns take precedence.
  // Make sure credentials.host + projectId reflect what OAuth gave us so the
  // tool tab shows correct connection state without re-entering anything.
  const existing = await prisma.connection.findUnique({ where: { userId } });
  const creds = (() => {
    try {
      return existing?.credentials ? (JSON.parse(existing.credentials) as Record<string, string>) : {};
    } catch {
      return {} as Record<string, string>;
    }
  })();
  if (project?.id) creds.projectId = project.id;
  creds.host = REGION_API_HOST[region];

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await prisma.connection.upsert({
    where: { userId },
    create: {
      userId,
      provider: "posthog",
      credentials: JSON.stringify(creds),
      posthogOauthAccessToken: tokens.access_token,
      posthogOauthRefreshToken: tokens.refresh_token ?? null,
      posthogOauthExpiresAt: expiresAt,
      posthogOauthScopes: tokens.scope ?? null,
      posthogOauthRegion: region,
      posthogUserId: me?.uuid ?? null,
      userEmail: existing?.userEmail ?? me?.email ?? null,
      userName:
        existing?.userName ??
        ([me?.firstName, me?.lastName].filter(Boolean).join(" ") || null),
    },
    update: {
      provider: "posthog",
      credentials: JSON.stringify(creds),
      posthogOauthAccessToken: tokens.access_token,
      posthogOauthRefreshToken: tokens.refresh_token ?? null,
      posthogOauthExpiresAt: expiresAt,
      posthogOauthScopes: tokens.scope ?? null,
      posthogOauthRegion: region,
      posthogUserId: me?.uuid ?? null,
      ...(existing?.userEmail || !me?.email ? {} : { userEmail: me.email }),
    },
  });

  const target = new URL(ret, url);
  target.searchParams.set("posthog", "connected");
  const res = NextResponse.redirect(target);
  clearCookies(res);
  return res;
}
