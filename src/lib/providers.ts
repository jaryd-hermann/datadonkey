// Per-provider config: how to identify the data tool, what credentials it
// needs, and whether its MCP / OAuth flow is wired up.
//
// PostHog has a public MCP server (mcp.posthog.com) and an OAuth server. The
// app is fully functional with PostHog today.
//
// Mixpanel and Amplitude don't ship official MCP servers yet. The UI lets
// users select them and save credentials; live Q&A and follow-up emails will
// turn on when their MCPs become available.

export type ProviderId = "posthog" | "mixpanel" | "amplitude";

export interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  helpText?: string;
  required?: boolean;
}

export interface ProviderConfig {
  id: ProviderId;
  name: string; // "PostHog" — used for display + bot name + wake word
  available: boolean; // is the live Q&A path functional today?
  hasOAuth: boolean; // is "Sign in with X" a real flow?
  oauthLabel?: string; // "Sign in with PostHog"
  mcpUrl?: string;
  credentialFields: CredentialField[];
  // Free-text help under the credential form
  setupHint?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  posthog: {
    id: "posthog",
    name: "PostHog",
    available: true,
    hasOAuth: true,
    oauthLabel: "Continue with PostHog",
    mcpUrl: "https://mcp.posthog.com/mcp",
    credentialFields: [
      {
        key: "apiKey",
        label: "Personal API Key",
        placeholder: "phx_…",
        secret: true,
        required: true,
        helpText:
          'Generate at <a class="underline" href="https://us.posthog.com/settings/user-api-keys#personal-api-keys" target="_blank" rel="noreferrer">us.posthog.com → settings → personal API keys</a>. Read scopes for query, insight, dashboard, feature_flag, experiment, action, cohort, error_tracking, session_recording.',
      },
      { key: "projectId", label: "Project ID", placeholder: "361026", required: true },
      {
        key: "host",
        label: "Host",
        placeholder: "https://us.posthog.com",
      },
    ],
    setupHint:
      "DataDonkey queries your PostHog project live during meetings via PostHog's MCP server.",
  },
  mixpanel: {
    id: "mixpanel",
    name: "Mixpanel",
    available: true,
    hasOAuth: true,
    oauthLabel: "Continue with Mixpanel",
    mcpUrl: "https://mcp.mixpanel.com/mcp",
    credentialFields: [
      {
        key: "accessToken",
        label: "Access Token",
        secret: true,
        required: true,
        helpText:
          "OAuth bearer token from Mixpanel. While we finish wiring up real OAuth, obtain one via Claude Desktop or another MCP-aware client and paste it here.",
      },
      {
        key: "region",
        label: "Region",
        placeholder: "us",
        helpText: "us / eu / in",
      },
    ],
    setupHint:
      "DataDonkey queries Mixpanel via the official MCP server (mcp.mixpanel.com).",
  },
  amplitude: {
    id: "amplitude",
    name: "Amplitude",
    available: true,
    hasOAuth: true,
    oauthLabel: "Continue with Amplitude",
    mcpUrl: "https://mcp.amplitude.com/mcp",
    credentialFields: [
      {
        key: "accessToken",
        label: "Access Token",
        secret: true,
        required: true,
        helpText:
          "OAuth bearer token from Amplitude. While we finish wiring up real OAuth, obtain one via Claude Desktop or another MCP-aware client and paste it here.",
      },
      {
        key: "region",
        label: "Region",
        placeholder: "us",
        helpText: "us / eu",
      },
    ],
    setupHint:
      "DataDonkey queries Amplitude via the official MCP server (mcp.amplitude.com).",
  },
};

export function getProvider(id: string | null | undefined): ProviderConfig {
  if (id === "mixpanel") return PROVIDERS.mixpanel;
  if (id === "amplitude") return PROVIDERS.amplitude;
  return PROVIDERS.posthog;
}
