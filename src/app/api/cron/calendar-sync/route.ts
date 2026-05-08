import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createBot } from "@/lib/recall";
import { eventMeetingUrl, listUpcomingEvents, refreshGoogleToken } from "@/lib/google";
import { getProvider } from "@/lib/providers";

// Polling sync: pull next 24h of calendar events for every connected user,
// dispatch a bot for any event whose start time is within ~2 minutes from now
// (and that we haven't already dispatched). Idempotent on Meeting.recallBotId.
//
// Trigger this from a cron every 1-5 minutes. On Vercel Pro the
// vercel.json cron handles it; locally hit it manually.

export async function GET(req: NextRequest) {
  const conns = await prisma.connection.findMany({
    where: {
      calendarConnected: true,
      googleAccessToken: { not: null },
      calendarAutojoinPolicy: { not: "off" },
    },
  });

  const origin = process.env.APP_URL ?? new URL(req.url).origin;
  const dispatched: { userId: string; eventId: string }[] = [];
  const skipped: { userId: string; eventId: string; reason: string }[] = [];
  const errors: { userId: string; reason: string }[] = [];

  for (const conn of conns) {
    if (!conn.googleAccessToken) continue;

    let accessToken = conn.googleAccessToken;
    if (
      conn.googleTokenExpiry &&
      conn.googleTokenExpiry.getTime() - Date.now() < 60_000
    ) {
      if (!conn.googleRefreshToken) {
        errors.push({ userId: conn.userId, reason: "no_refresh_token" });
        continue;
      }
      try {
        const t = await refreshGoogleToken(conn.googleRefreshToken);
        accessToken = t.access_token;
        await prisma.connection.update({
          where: { userId: conn.userId },
          data: {
            googleAccessToken: t.access_token,
            googleTokenExpiry: new Date(Date.now() + t.expires_in * 1000),
          },
        });
      } catch (err) {
        console.error("[calendar-sync] refresh failed:", conn.userId, err);
        errors.push({ userId: conn.userId, reason: "refresh_failed" });
        continue;
      }
    }

    let events;
    try {
      events = await listUpcomingEvents(accessToken, 24);
    } catch (err) {
      console.error("[calendar-sync] list failed:", conn.userId, err);
      errors.push({ userId: conn.userId, reason: "list_failed" });
      continue;
    }

    const provider = getProvider(conn.provider);

    for (const ev of events) {
      const url = eventMeetingUrl(ev);
      if (!url) {
        skipped.push({ userId: conn.userId, eventId: ev.id, reason: "no_meeting_url" });
        continue;
      }
      const startStr = ev.start?.dateTime;
      if (!startStr) {
        skipped.push({ userId: conn.userId, eventId: ev.id, reason: "no_start" });
        continue;
      }
      const start = new Date(startStr);
      const minsToStart = (start.getTime() - Date.now()) / 60_000;
      if (minsToStart > 2 || minsToStart < -10) {
        skipped.push({
          userId: conn.userId,
          eventId: ev.id,
          reason: `not_now (${minsToStart.toFixed(1)}m)`,
        });
        continue;
      }
      if (conn.calendarAutojoinPolicy === "host_only" && !ev.organizer?.self) {
        skipped.push({
          userId: conn.userId,
          eventId: ev.id,
          reason: "host_only_not_organizer",
        });
        continue;
      }
      const policy = await prisma.calendarEventPolicy.findUnique({
        where: { userId_eventId: { userId: conn.userId, eventId: ev.id } },
      });
      if (policy?.skip) {
        skipped.push({ userId: conn.userId, eventId: ev.id, reason: "user_opted_out" });
        continue;
      }
      if (policy?.dispatched) {
        skipped.push({
          userId: conn.userId,
          eventId: ev.id,
          reason: "already_dispatched",
        });
        continue;
      }
      const existing = await prisma.meeting.findFirst({
        where: {
          userId: conn.userId,
          OR: [{ calendarEventId: ev.id }, { meetingUrl: url }],
        },
      });
      if (existing) {
        skipped.push({
          userId: conn.userId,
          eventId: ev.id,
          reason: "already_dispatched_meeting",
        });
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
            userId: conn.userId,
            recallBotId: bot.id,
            meetingUrl: url,
            title: ev.summary ?? null,
            status: "joining",
            calendarEventId: ev.id,
          },
        });
        await prisma.calendarEventPolicy.upsert({
          where: { userId_eventId: { userId: conn.userId, eventId: ev.id } },
          create: {
            userId: conn.userId,
            eventId: ev.id,
            dispatched: true,
            botId: bot.id,
            meetingId: m.id,
          },
          update: { dispatched: true, botId: bot.id, meetingId: m.id },
        });
        dispatched.push({ userId: conn.userId, eventId: ev.id });
      } catch (err) {
        console.error("[calendar-sync] dispatch failed:", conn.userId, ev.id, err);
        skipped.push({ userId: conn.userId, eventId: ev.id, reason: "dispatch_failed" });
      }
    }
  }

  return NextResponse.json({ ok: true, dispatched, skipped, errors });
}
