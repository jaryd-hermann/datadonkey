import { NextResponse } from "next/server";

// Client ID Metadata Document (CIMD) for PostHog OAuth.
// The URL of this document IS our client_id — PostHog fetches it during the
// OAuth handshake to learn about us. No registration required on PostHog's
// side; the doc itself declares what we need.
//
// Spec: https://posthog.com/docs/api/oauth (CIMD section)

export async function GET() {
  const origin = process.env.APP_URL ?? "https://datadonkey.ai";
  const body = {
    client_name: "DataDonkey",
    client_uri: origin,
    logo_uri: `${origin}/datadonkey.png`,
    tos_uri: `${origin}/`,
    policy_uri: `${origin}/`,
    redirect_uris: [`${origin}/auth/callback/posthog`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: "openid email profile",
  };
  return NextResponse.json(body, {
    headers: {
      // Cache for 5 min so PostHog doesn't hit it on every authorize.
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/json",
    },
  });
}
