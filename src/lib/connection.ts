import { prisma } from "./db";
import { getProvider, type ProviderConfig, type ProviderId } from "./providers";

// Per-provider credential bag. Shape depends on the provider — we use a
// permissive index signature so different providers can store their own keys
// without changing the type.
export interface Credentials {
  apiKey?: string;
  projectId?: string;
  host?: string;
  serviceAccountName?: string;
  serviceAccountSecret?: string;
  secretKey?: string;
  [key: string]: string | undefined;
}

export interface ConnectionView {
  exists: boolean;
  signedUp: boolean; // has user submitted name/company/tool?
  connected: boolean; // has user submitted credentials?
  userName: string | null;
  userCompany: string | null;
  userEmail: string | null;
  provider: ProviderConfig;
  credentials: Credentials;
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
    };
  }
  const provider = getProvider(row.provider);
  const credentials = parseCredentials(row.credentials);
  // "Connected" if every required credential field has a value.
  const connected = provider.credentialFields
    .filter((f) => !f.placeholder?.startsWith("https://")) // host has a default; don't require a paste
    .every((f) => {
      const v = credentials[f.key as keyof Credentials];
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
