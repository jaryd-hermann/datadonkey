import { prisma } from "./db";
import { getProvider, type ProviderConfig, type ProviderId } from "./providers";
import { refreshAccessToken } from "./posthog-oauth";

// Per-provider credential bag. Shape depends on the provider — we use a
// permissive index signature so different providers can store their own keys
// without changing the type.
export interface Credentials {
  // PostHog
  apiKey?: string;
  projectId?: string;
  host?: string;
  // PostHog OAuth (when present, takes precedence over apiKey)
  oauthAccessToken?: string;
  oauthRegion?: string;
  // Mixpanel + Amplitude (OAuth bearer)
  accessToken?: string;
  region?: string;
  [key: string]: string | undefined;
}

export interface ConnectionView {
  exists: boolean;
  signedUp: boolean;
  connected: boolean;
  userName: string | null;
  userCompany: string | null;
  userEmail: string | null;
  provider: ProviderConfig;
  credentials: Credentials;
  prefLive: boolean;
  prefFollowup: boolean;
  calendarConnected: boolean;
  calendarProvider: string | null;
  calendarAutojoinPolicy: "all" | "host_only" | "off";
  slackConnected: boolean;
  slackTeamName: string | null;
  slackBotToken: string | null;
  slackUserId: string | null;
  slackBotUserId: string | null;
}

function parseCredentials(s: string | null): Credentials {
  if (!s) return {};
  try {
    return JSON.parse(s) as Credentials;
  } catch {
    return {};
  }
}

export async function readConnection(): Promise<ConnectionView> {
  const row = await prisma.connection.findUnique({ where: { id: "default" } });
  if (!row) {
    return {
      exists: false,
      signedUp: false,
      connected: false,
      userName: null,
      userCompany: null,
      userEmail: null,
      provider: getProvider("posthog"),
      credentials: {},
      prefLive: true,
      prefFollowup: true,
      calendarConnected: false,
      calendarProvider: null,
      calendarAutojoinPolicy: "all",
      slackConnected: false,
      slackTeamName: null,
      slackBotToken: null,
      slackUserId: null,
      slackBotUserId: null,
    };
  }
  const provider = getProvider(row.provider);
  const credentials = parseCredentials(row.credentials);

  // Inject the PostHog OAuth access token (refreshing if needed) so callers
  // see a unified Credentials bag regardless of how the user authed.
  if (row.provider === "posthog" && row.posthogOauthAccessToken) {
    const token = await ensureFreshPosthogAccessToken(row);
    if (token) {
      credentials.oauthAccessToken = token;
      if (row.posthogOauthRegion) credentials.oauthRegion = row.posthogOauthRegion;
    }
  }

  // "Connected" if every credential field marked required has a value, OR
  // we have a PostHog OAuth token (which can replace apiKey + projectId).
  const hasOauth = !!credentials.oauthAccessToken;
  const connected = hasOauth
    ? true
    : provider.credentialFields
        .filter((f) => f.required)
        .every((f) => {
          const v = credentials[f.key];
          return typeof v === "string" && v.length > 0;
        });
  return {
    exists: true,
    signedUp: !!(row.userName && row.userCompany),
    connected,
    userName: row.userName,
    userCompany: row.userCompany,
    userEmail: row.userEmail,
    provider,
    credentials,
    prefLive: row.prefLive,
    prefFollowup: row.prefFollowup,
    calendarConnected: row.calendarConnected,
    calendarProvider: row.calendarProvider,
    calendarAutojoinPolicy: (row.calendarAutojoinPolicy as
      | "all"
      | "host_only"
      | "off") ?? "all",
    slackConnected: row.slackConnected,
    slackTeamName: row.slackTeamName,
    slackBotToken: row.slackBotToken,
    slackUserId: row.slackUserId,
    slackBotUserId: row.slackBotUserId,
  };
}

export async function saveSignup(input: {
  userName: string;
  userCompany: string;
  userEmail?: string;
  provider: ProviderId;
}): Promise<void> {
  await prisma.connection.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      userName: input.userName,
      userCompany: input.userCompany,
      userEmail: input.userEmail ?? null,
      provider: input.provider,
    },
    update: {
      userName: input.userName,
      userCompany: input.userCompany,
      userEmail: input.userEmail ?? undefined,
      provider: input.provider,
    },
  });
}

// Refresh the PostHog access token if it's within 60s of expiry. Persists
// the new token to the row. Returns the freshest token (refreshed or current).
async function ensureFreshPosthogAccessToken(row: {
  posthogOauthAccessToken: string | null;
  posthogOauthRefreshToken: string | null;
  posthogOauthExpiresAt: Date | null;
}): Promise<string | null> {
  const current = row.posthogOauthAccessToken;
  if (!current) return null;
  const expiresAt = row.posthogOauthExpiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (expiresAt - Date.now() > 60_000) return current;
  if (!row.posthogOauthRefreshToken) return current;

  try {
    const r = await refreshAccessToken(row.posthogOauthRefreshToken);
    const newExpiresAt = new Date(Date.now() + r.expires_in * 1000);
    await prisma.connection.update({
      where: { id: "default" },
      data: {
        posthogOauthAccessToken: r.access_token,
        posthogOauthRefreshToken: r.refresh_token ?? row.posthogOauthRefreshToken,
        posthogOauthExpiresAt: newExpiresAt,
      },
    });
    return r.access_token;
  } catch (err) {
    console.warn("[posthog-oauth] proactive refresh failed:", err);
    return current;
  }
}

export async function saveCredentials(
  provider: ProviderId,
  credentials: Credentials,
): Promise<void> {
  await prisma.connection.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      provider,
      credentials: JSON.stringify(credentials),
    },
    update: {
      provider,
      credentials: JSON.stringify(credentials),
    },
  });
}
