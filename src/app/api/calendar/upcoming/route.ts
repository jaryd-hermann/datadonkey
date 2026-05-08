import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  eventMeetingUrl,
  listUpcomingEvents,
  refreshGoogleToken,
  type CalendarEvent,
} from "@/lib/google";
import { requireUserId } from "@/lib/auth";

// GET /api/calendar/upcoming
// Returns the next ~7 days of events that have a meeting link, plus the
// per-event opt-in/out policy. Used by the dashboard Meetings tab.

export async function GET() {
  const auth = await requireUserId();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const conn = await prisma.connection.findUnique({ where: { userId } });
  if (!conn?.calendarConnected || !conn.googleAccessToken) {
    return NextResponse.json({ events: [], connected: false });
  }

  // Refresh the access token if it's about to expire (and we have a refresh
  // token from the original consent).
  let accessToken = conn.googleAccessToken;
  const expiry = conn.googleTokenExpiry;
  if (expiry && expiry.getTime() < Date.now() + 60_000 && conn.googleRefreshToken) {
    try {
      const refreshed = await refreshGoogleToken(conn.googleRefreshToken);
      accessToken = refreshed.access_token;
      await prisma.connection.update({
        where: { userId },
        data: {
          googleAccessToken: accessToken,
          googleTokenExpiry: new Date(Date.now() + refreshed.expires_in * 1000),
        },
      });
    } catch (err) {
      console.warn("[calendar] refresh failed:", err);
    }
  }

  let events: CalendarEvent[] = [];
  try {
    events = await listUpcomingEvents(accessToken, 24 * 7);
  } catch (err) {
    console.error("[calendar] list failed:", err);
    return NextResponse.json({ events: [], connected: true, error: "list_failed" });
  }

  const filtered = events.filter((e) => eventMeetingUrl(e) != null);
  const ids = filtered.map((e) => e.id);
  const policies = await prisma.calendarEventPolicy.findMany({
    where: { userId, eventId: { in: ids } },
  });
  const policyByEvent = new Map(policies.map((p) => [p.eventId, p]));

  const enriched = filtered.map((e) => {
    const p = policyByEvent.get(e.id);
    return {
      id: e.id,
      summary: e.summary ?? "(no title)",
      meetingUrl: eventMeetingUrl(e),
      start: e.start?.dateTime ?? e.start?.date ?? null,
      end: e.end?.dateTime ?? e.end?.date ?? null,
      attendees: (e.attendees ?? []).map((a) => ({
        email: a.email ?? null,
        name: a.displayName ?? null,
      })),
      skip: p?.skip ?? false,
      dispatched: p?.dispatched ?? false,
      meetingId: p?.meetingId ?? null,
    };
  });

  return NextResponse.json({ events: enriched, connected: true });
}

// PATCH /api/calendar/upcoming  { eventId, skip }
// Toggle whether DataDonkey should join this event when its time comes.
export async function PATCH(req: Request) {
  const auth = await requireUserId();
  if (auth instanceof NextResponse) return auth;
  const userId = auth;

  const body = (await req.json().catch(() => ({}))) as {
    eventId?: string;
    skip?: boolean;
  };
  if (!body.eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }
  const skip = !!body.skip;
  await prisma.calendarEventPolicy.upsert({
    where: { userId_eventId: { userId, eventId: body.eventId } },
    create: { userId, eventId: body.eventId, skip },
    update: { skip },
  });
  return NextResponse.json({ ok: true });
}
