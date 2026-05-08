# What unblocked us with PostHog OAuth via CIMD

Hey! Quick writeup of what worked + what tripped us up — useful as raw material for docs.

---

## What we wanted

One-click "Continue with PostHog" that does two things at once:

1. SSO into our app (DataDonkey) — respects the user's PostHog SSO/SAML/2FA, no separate password
2. Same access token authenticates against `mcp.posthog.com` so we can query the user's data without ever asking them for a Personal API Key

Goal was to delete the "paste a `phx_…` key + project ID" step from onboarding. That step was killing conversion and also a non-starter for orgs that disable PATs under SSO enforcement.

## What we tried first

1. **Self-serve OAuth app registration on PostHog Cloud.** The handbook page (`posthog.com/handbook/engineering/oauth-development-guide`) suggests visiting `Settings → OAuth applications` to register a normal `client_id` / `client_secret` pair. On us.posthog.com the page exists at `/settings/organization-oauth-apps` but there's no Create button visible — looked gated, role-locked, or not yet shipped. Dead end without emailing support.

2. **CIMD per the doc you shared.** Hosted a metadata JSON at `https://datadonkey.ai/.well-known/oauth-client`, used that URL as our `client_id`, started the flow against `oauth.posthog.com/oauth/authorize`. Got bounced through a region picker to `us.posthog.com/oauth/authorize`, which rejected with:

   ```
   {"error":"invalid_request","error_description":"Invalid client_id parameter value."}
   ```

   So it looked like CIMD wasn't actually accepted on the regional Django servers, even though it was on the doc. We were about to email PostHog for a registered `client_id` as a fallback.

## What unblocked us

You confirmed PostHog *does* accept CIMD, which sent us back to look at our own setup. Three things were wrong on our side — none of them obvious from the error message:

1. **Apex → www redirect broke CIMD identity.** Our DNS had `datadonkey.ai` 307-redirecting to `www.datadonkey.ai`. CIMD treats the URL itself as the client identity. When PostHog fetched `https://datadonkey.ai/.well-known/oauth-client`, followed the redirect, and ended up at a `www.` URL, it couldn't reconcile "the client_id we said we are" vs "where the doc actually lives." Strict origin match. **Fix:** we made the canonical CIMD URL `https://www.datadonkey.ai/.well-known/oauth-client` and use that consistently as both the metadata location and the `client_id` parameter, with no redirect in the way.

2. **CIMD doc was missing the self-referential `client_id` field.** Per `draft-parecki-oauth-client-id-metadata-document` §3, the JSON body MUST include a `client_id` field whose value equals the URL the doc is hosted at. We didn't have it. Some servers strict-check this. We also added `application_type: "web"` while we were in there.

3. **Scope was too narrow.** We initially only requested `openid email profile`, thinking that's what SSO needs. That gets you a token that authenticates the user but doesn't unlock MCP data access. We added the data scopes (`query:read insight:read dashboard:read feature_flag:read experiment:read action:read cohort:read error_tracking:read session_recording:read`) so the same token from the SSO flow is also a working MCP bearer. This is genuinely the killer combo of CIMD for our use case — one consent screen, one token, both auth concerns solved.

After those three fixes the flow works end-to-end: orange "Continue with PostHog" button → consent screen with our logo + scopes listed → redirect back to our app with a working access + refresh token pair → MCP queries Just Work using that same token.

## Things that would help others avoid the same potholes (doc suggestions)

- **Be explicit about origin/redirect rules.** "If your CIMD URL redirects, the redirect target must match exactly, or PostHog will reject." We chased the `invalid_client_id` for an hour assuming the issue was on PostHog's side.
- **Show a complete, minimal CIMD JSON in the docs.** Including `client_id` self-reference, `application_type`, and at least one example with the data scopes — not just the `openid email profile` SSO-only example. Most third parties building on PostHog want the data access too; the "MCP via SSO token" combo is the actual reason to do this.
- **Mention the regional host situation.** The flow goes through `oauth.posthog.com` for region picking, then `us.posthog.com` / `eu.posthog.com` for actual auth. If a developer wants to skip the picker (we did, for users who already chose region in our onboarding), it's worth saying "you can hit the regional host directly with the same params." Not obvious without trial-and-error.
- **A note on `token_endpoint_auth_method: "none"`** — it's correct for CIMD (no client_secret), but devs with a backend should still do the token exchange server-side so refresh tokens never touch the browser. Worth calling out as a security best-practice rather than letting people put the exchange in client-side JS.
- **Clarify the relationship between the OAuth token's scopes and MCP access.** The fact that an OAuth-issued token can be used as a bearer at `mcp.posthog.com` *and* that the scopes you request at OAuth time gate what the MCP can do — that's the high-leverage thing. We figured it out by reading code; it deserves a paragraph.

For us this was a really nice unlock — the user-facing UX went from "paste two keys, pick a region, hope your project ID is right" to "click one button." Happy to share the actual CIMD doc we ended up with if it's useful as an example for the docs.
