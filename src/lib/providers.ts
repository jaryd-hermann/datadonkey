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
        helpText: "Generate at posthog.com → settings → personal API keys. Read scopes for query, insight, dashboard, feature_flag, experiment, action, cohort, error_tracking, session_recording.",
      },
      { key: "projectId", label: "Project ID", placeholder: "361026" },
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
    available: false,
    hasOAuth: false,
    credentialFields: [
      { key: "projectId", label: "Project ID", placeholder: "12345" },
      {
        key: "serviceAccountName",
        label: "Service Account Username",
        placeholder: "datadonkey.<id>.mp-service-account",
      },
      {
        key: "serviceAccountSecret",
        label: "Service Account Secret",
        secret: true,
      },
    ],
    setupHint:
      "Mixpanel doesn't ship an MCP server yet. We'll save your credentials and turn on live Q&A the moment it's available.",
  },
  amplitude: {
    id: "amplitude",
    name: "Amplitude",
    available: false,
    hasOAuth: false,
    credentialFields: [
      { key: "apiKey", label: "API Key", secret: true },
      { key: "secretKey", label: "Secret Key", secret: true },
      { key: "projectId", label: "Project ID", placeholder: "12345" },
    ],
    setupHint:
      "Amplitude doesn't ship an MCP server yet. We'll save your credentials and turn on live Q&A the moment it's available.",
  },
};

export function getProvider(id: string | null | undefined): ProviderConfig {
  if (id === "mixpanel") return PROVIDERS.mixpanel;
  if (id === "amplitude") return PROVIDERS.amplitude;
  return PROVIDERS.posthog;
}
