import { prisma } from "./db";
import { getProvider, type ProviderConfig, type ProviderId } from "./providers";

// Per-provider credential bag. Shape depends on the provider — we use a
// permissive index signature so different providers can store their own keys
// without changing the type.
export interface Credentials {
  // PostHog
  apiKey?: string;
  projectId?: string;
  host?: string;
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
  slackConnected: boolean;
  slackTeamName: string | null;
  slackBotToken: string | null;
  slackUserId: string | null;
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
      slackConnected: false,
      slackTeamName: null,
      slackBotToken: null,
      slackUserId: null,
    };
  }
  const provider = getProvider(row.provider);
  const credentials = parseCredentials(row.credentials);
  // "Connected" if every credential field marked required has a value.
  const connected = provider.credentialFields
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
    slackConnected: row.slackConnected,
    slackTeamName: row.slackTeamName,
    slackBotToken: row.slackBotToken,
    slackUserId: row.slackUserId,
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
