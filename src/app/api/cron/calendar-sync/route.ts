import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createBot } from "@/lib/recall";
import { eventMeetingUrl, listUpcomingEvents, refreshGoogleToken } from "@/lib/google";
import { getProvider } from "@/lib/providers";

// Polling sync: pull next 24h of calendar events, dispatch a bot for any
// event whose start time is within ~2 minutes from now (and that we haven't
// already dispatched). Idempotent on Meeting.recallBotId; we mark each
// dispatched event by writing a Meeting whose meetingUrl is the event link.
//
// Trigger this from a cron every 1-5 minutes. Local: hit it manually or set
// up a node-cron in dev.

export async function GET(req: NextRequest) {
  const conn = await prisma.connection.findUnique({ where: { id: "default" } });
  if (!conn?.calendarConnected || !conn.googleAccessToken) {
    return NextResponse.json({ ok: false, reason: "calendar_not_connected" });
  }
  if (conn.calendarAutojoinPolicy === "off") {
    return NextResponse.json({ ok: false, reason: "autojoin_disabled" });
  }

  // Refresh access token if it's expiring within 60s
  let accessToken = conn.googleAccessToken;
  if (conn.googleTokenExpiry && conn.googleTokenExpiry.getTime() - Date.now() < 60_000) {
    if (!conn.googleRefreshToken) {
      return NextResponse.json({ ok: false, reason: "no_refresh_token" });
    }
    try {
      const t = await refreshGoogleToken(conn.googleRefreshToken);
      accessToken = t.access_token;
      await prisma.connection.update({
        where: { id: "default" },
        data: {
          googleAccessToken: t.access_token,
          googleTokenExpiry: new Date(Date.now() + t.expires_in * 1000),
        },
      });
    } catch (err) {
      console.error("[calendar-sync] refresh failed:", err);
      return NextResponse.json({ ok: false, reason: "refresh_failed" });
    }
  }

  let events;
  try {
    events = await listUpcomingEvents(accessToken, 24);
  } catch (err) {
    console.error("[calendar-sync] list failed:", err);
    return NextResponse.json({ ok: false, reason: "list_failed" });
  }

  const origin = process.env.APP_URL ?? new URL(req.url).origin;
  const provider = getProvider(conn.provider);
  const dispatched: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const ev of events) {
    const url = eventMeetingUrl(ev);
    if (!url) {
      skipped.push({ id: ev.id, reason: "no_meeting_url" });
      continue;
    }
    const startStr = ev.start?.dateTime;
    if (!startStr) {
      skipped.push({ id: ev.id, reason: "no_start" });
      continue;
    }
    const start = new Date(startStr);
    const minsToStart = (start.getTime() - Date.now()) / 60_000;
    if (minsToStart > 2 || minsToStart < -10) {
      skipped.push({ id: ev.id, reason: `not_now (${minsToStart.toFixed(1)}m)` });
      continue;
    }
    if (conn.calendarAutojoinPolicy === "host_only" && !ev.organizer?.self) {
      skipped.push({ id: ev.id, reason: "host_only_not_organizer" });
      continue;
    }
    const policy = await prisma.calendarEventPolicy.findUnique({
      where: { eventId: ev.id },
    });
    if (policy?.skip) {
      skipped.push({ id: ev.id, reason: "user_opted_out" });
      continue;
    }
    if (policy?.dispatched) {
      skipped.push({ id: ev.id, reason: "already_dispatched" });
      continue;
    }
    const existing = await prisma.meeting.findFirst({
      where: { OR: [{ calendarEventId: ev.id }, { meetingUrl: url }] },
    });
    if (existing) {
      skipped.push({ id: ev.id, reason: "already_dispatched_meeting" });
      continue;
    }

    try {
      const bot = await createBot({
        meetingUrl: url,
        botName: provider.name,
        webhookUrl: `${origin}/api/recall/webhook`,
      });
      const m = await prisma.meeting.create({
        data: {
          recallBotId: bot.id,
          meetingUrl: url,
          title: ev.summary ?? null,
          status: "joining",
          calendarEventId: ev.id,
        },
      });
      await prisma.calendarEventPolicy.upsert({
        where: { eventId: ev.id },
        create: { eventId: ev.id, dispatched: true, botId: bot.id, meetingId: m.id },
        update: { dispatched: true, botId: bot.id, meetingId: m.id },
      });
      dispatched.push(ev.id);
    } catch (err) {
      console.error("[calendar-sync] dispatch failed for", ev.id, err);
      skipped.push({ id: ev.id, reason: "dispatch_failed" });
    }
  }

  return NextResponse.json({ ok: true, dispatched, skipped });
}
