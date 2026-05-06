import crypto from "node:crypto";

// PostHog OAuth (CIMD-based, no client secret). Region-agnostic OAuth host;
// API host depends on which region the user picked.

export const POSTHOG_OAUTH_BASE = "https://oauth.posthog.com";

export type PosthogRegion = "us" | "eu";

export const REGION_API_HOST: Record<PosthogRegion, string> = {
  us: "https://us.posthog.com",
  eu: "https://eu.posthog.com",
};

// Two ways to identify ourselves to PostHog OAuth:
//
//   1. POSTHOG_OAUTH_CLIENT_ID (a UUID/string registered via PostHog's
//      Django admin). Required today — PostHog Cloud's regional hosts
//      (us.posthog.com / eu.posthog.com) don't yet accept URL-as-client-id.
//   2. CIMD URL fallback (forward-compat). The /.well-known/oauth-client
//      doc is hosted regardless; the moment PostHog ships CIMD support
//      we get it for free.
//
// If POSTHOG_OAUTH_CLIENT_SECRET is also set, the token exchange will
// include it (confidential client). Otherwise we send only PKCE
// (public client).
export function clientId(): string {
  const registered = process.env.POSTHOG_OAUTH_CLIENT_ID?.trim();
  if (registered) return registered;
  const origin = process.env.APP_URL ?? "https://datadonkey.ai";
  return `${origin}/.well-known/oauth-client`;
}

export function clientSecret(): string | null {
  const secret = process.env.POSTHOG_OAUTH_CLIENT_SECRET?.trim();
  return secret || null;
}

export function redirectUri(): string {
  const origin = process.env.APP_URL ?? "https://datadonkey.ai";
  return `${origin}/auth/callback/posthog`;
}

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
    scope: opts.scope ?? "openid email profile",
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
  if (!r.ok) return null;
  const j = (await r.json()) as { results?: Array<Record<string, unknown>> };
  const first = (j.results ?? [])[0];
  if (!first) return null;
  const org = first.organization as Record<string, unknown> | undefined;
  return {
    id: String(first.id ?? ""),
    name: String(first.name ?? ""),
    organizationName: typeof org?.name === "string" ? (org.name as string) : null,
  };
}
