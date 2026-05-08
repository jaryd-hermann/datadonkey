import crypto from "node:crypto";

// PostHog OAuth (CIMD-based, no client secret). Region-agnostic OAuth host;
// API host depends on which region the user picked.

export const POSTHOG_OAUTH_BASE = "https://oauth.posthog.com";

export type PosthogRegion = "us" | "eu";

export const REGION_API_HOST: Record<PosthogRegion, string> = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
};

// CIMD origin must be the canonical hostname that does NOT redirect.
// On Vercel apex `datadonkey.ai` 307s to `www.datadonkey.ai`, which
// breaks CIMD because the URL itself IS our identity — a redirect can
// look like a different identifier to OAuth servers.
export function canonicalOrigin(): string {
  return process.env.POSTHOG_CIMD_ORIGIN ?? "https://www.datadonkey.ai";
}

// POSTHOG_OAUTH_CLIENT_ID lets us swap to a registered UUID if PostHog
// support hands one out instead. Otherwise our client_id IS the CIMD URL.
export function clientId(): string {
  const registered = process.env.POSTHOG_OAUTH_CLIENT_ID?.trim();
  if (registered) return registered;
  return `${canonicalOrigin()}/.well-known/oauth-client`;
}

export function clientSecret(): string | null {
  const secret = process.env.POSTHOG_OAUTH_CLIENT_SECRET?.trim();
  return secret || null;
}

export function redirectUri(): string {
  return `${canonicalOrigin()}/auth/callback/posthog`;
}

// Scopes requested. openid+email+profile for SSO identity; the rest
// unlock MCP read access so the same access_token works for both
// authentication AND data queries (no separate Personal API Key).
export const POSTHOG_OAUTH_SCOPE = [
  "openid",
  "email",
  "profile",
  // organization + project scopes are required for /api/projects/ + the
  // org name lookup. Without them, OAuth users get a connected token but
  // we can't show project name / org / project ID on the dashboard.
  "organization:read",
  "project:read",
  "query:read",
  "insight:read",
  "dashboard:read",
  "feature_flag:read",
  "experiment:read",
  "action:read",
  "cohort:read",
  "error_tracking:read",
  "session_recording:read",
].join(" ");

function base64url(input: Buffer | Uint8Array): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

export function generatePKCE(): PKCEPair {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function generateState(): string {
  return base64url(crypto.randomBytes(16));
}

export interface AuthorizeUrlOpts {
  codeChallenge: string;
  state: string;
  scope?: string;
}

export function buildAuthorizeUrl(opts: AuthorizeUrlOpts): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    state: opts.state,
    scope: opts.scope ?? POSTHOG_OAUTH_SCOPE,
  });
  return `${POSTHOG_OAUTH_BASE}/oauth/authorize?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  id_token?: string;
}

function tokenBody(extra: Record<string, string>): Record<string, string> {
  const body: Record<string, string> = {
    ...extra,
    client_id: clientId(),
  };
  const secret = clientSecret();
  if (secret) body.client_secret = secret;
  return body;
}

export async function exchangeCode(args: {
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const r = await fetch(`${POSTHOG_OAUTH_BASE}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      tokenBody({
        grant_type: "authorization_code",
        code: args.code,
        redirect_uri: redirectUri(),
        code_verifier: args.codeVerifier,
      }),
    ),
  });
  if (!r.ok) {
    throw new Error(`PostHog token exchange failed: ${r.status} ${await r.text()}`);
  }
  return (await r.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const r = await fetch(`${POSTHOG_OAUTH_BASE}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      tokenBody({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    ),
  });
  if (!r.ok) {
    throw new Error(`PostHog refresh failed: ${r.status} ${await r.text()}`);
  }
  return (await r.json()) as TokenResponse;
}

export async function getMe(
  accessToken: string,
  region: PosthogRegion,
): Promise<{ uuid: string; email: string; firstName?: string; lastName?: string } | null> {
  const r = await fetch(`${REGION_API_HOST[region]}/api/users/@me/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  const j = (await r.json()) as Record<string, unknown>;
  return {
    uuid: String(j.uuid ?? ""),
    email: String(j.email ?? ""),
    firstName: typeof j.first_name === "string" ? j.first_name : undefined,
    lastName: typeof j.last_name === "string" ? j.last_name : undefined,
  };
}

// Discover the user's first scoped team (project) via the API. Used so we
// don't need to ask for projectId separately after OAuth.
export async function discoverFirstProject(
  accessToken: string,
  region: PosthogRegion,
): Promise<{ id: string; name: string; organizationName: string | null } | null> {
  const r = await fetch(`${REGION_API_HOST[region]}/api/projects/`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    console.warn(`[posthog-oauth] /api/projects/ ${r.status}: ${text.slice(0, 200)}`);
    return null;
  }
  const j = (await r.json()) as { results?: Array<Record<string, unknown>> };
  const first = (j.results ?? [])[0];
  if (!first) {
    console.warn("[posthog-oauth] /api/projects/ returned no results");
    return null;
  }
  const org = first.organization as Record<string, unknown> | undefined;
  return {
    id: String(first.id ?? ""),
    name: String(first.name ?? ""),
    organizationName: typeof org?.name === "string" ? (org.name as string) : null,
  };
}
