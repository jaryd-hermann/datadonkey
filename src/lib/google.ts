// Google Calendar OAuth + minimal events list. Calendar-only — sign-in is
// handled separately via Supabase's Google provider.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function buildGoogleInstallUrl(state: string, redirectUri: string) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_OAUTH_CLIENT_ID missing");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<GoogleTokenResponse> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google creds missing");
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!r.ok) throw new Error(`Google token exchange failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as GoogleTokenResponse;
}

export async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google creds missing");
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!r.ok) throw new Error(`Google refresh failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as { access_token: string; expires_in: number };
}

export async function getGoogleUserEmail(accessToken: string): Promise<string | null> {
  const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { email?: string };
  return j.email ?? null;
}

export interface CalendarEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { uri?: string; entryPointType?: string }[];
  };
  attendees?: { email?: string; displayName?: string; self?: boolean }[];
  organizer?: { email?: string; self?: boolean };
}

export async function listUpcomingEvents(
  accessToken: string,
  hoursAhead = 24,
): Promise<CalendarEvent[]> {
  const now = new Date();
  const max = new Date(now.getTime() + hoursAhead * 3600_000);
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: max.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  const r = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!r.ok) throw new Error(`Calendar list failed: ${r.status}`);
  const j = (await r.json()) as { items?: CalendarEvent[] };
  return j.items ?? [];
}

// Pull a meeting URL out of a calendar event. Prefers Google Meet, then any
// conferenceData entry, then the description text (Zoom/Teams URLs).
export function eventMeetingUrl(ev: CalendarEvent): string | null {
  if (ev.hangoutLink) return ev.hangoutLink;
  for (const ep of ev.conferenceData?.entryPoints ?? []) {
    if (ep.entryPointType === "video" && ep.uri) return ep.uri;
  }
  return null;
}
