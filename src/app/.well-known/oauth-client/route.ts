import { NextResponse } from "next/server";
import { canonicalOrigin, POSTHOG_OAUTH_SCOPE } from "@/lib/posthog-oauth";

// Client ID Metadata Document (CIMD) per draft-parecki-oauth-client-id-metadata-document.
// The URL of this document IS our client_id. The body's client_id field
// must equal that URL (self-reference) so OAuth servers can verify
// identity after fetching.

export async function GET() {
  const origin = canonicalOrigin();
  const selfUrl = `${origin}/.well-known/oauth-client`;
  const body = {
    client_id: selfUrl,
    client_name: "DataDonkey",
    client_uri: origin,
    logo_uri: `${origin}/datadonkey.png`,
    tos_uri: `${origin}/`,
    policy_uri: `${origin}/`,
    redirect_uris: [`${origin}/auth/callback/posthog`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
    scope: POSTHOG_OAUTH_SCOPE,
  };
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/json",
    },
  });
}
