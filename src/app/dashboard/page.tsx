"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AppShell } from "@/components/AppShell";
import { PosthogConnectButton } from "@/components/PosthogConnectButton";

interface Question {
  id: string;
  question: string;
  answer: string;
  askerName: string | null;
  latencyMs: number | null;
  createdAt: string;
}

interface Meeting {
  id: string;
  recallBotId: string;
  meetingUrl: string;
  status: string;
  title: string | null;
  participants: string | null;
  createdAt: string;
  endedAt: string | null;
  questions: Question[];
  pipelineStage: string | null;
  pipelineStageAt: string | null;
  pipelineStages: string | null;
  pipelineDismissed: boolean;
  followupAttempted?: boolean;
  followupReport?: string | null;
}

interface PipelineEntry {
  stage: string;
  ts: number;
  ok?: boolean;
  detail?: string;
}

const PIPELINE_STAGES = [
  "listening",
  "reviewing",
  "analyzing",
  "querying",
  "delivering",
  "done",
] as const;
const STAGE_LABELS: Record<string, string> = {
  listening: "Listening",
  reviewing: "Reviewing",
  analyzing: "Analyzing",
  querying: "Querying data",
  delivering: "Delivering",
  done: "Delivered",
  failed: "Stopped",
};
const STAGE_DESCS: Record<string, string> = {
  listening: "Capturing the conversation in real time.",
  reviewing: "Reading through the meeting.",
  analyzing: "Pulling out data questions worth answering.",
  querying: "Asking your data tool for real numbers.",
  delivering: "Sending the follow-up to your inbox + Slack.",
  done: "All done — follow-up delivered.",
  failed: "Something went wrong. Try Re-generate from the meeting page.",
};

interface ConnectionInfo {
  exists: boolean;
  signedUp: boolean;
  connected: boolean;
  userName: string | null;
  userCompany: string | null;
  userEmail: string | null;
  userRole: string | null;
  orgSize: string | null;
  isPartner: boolean;
  provider: { id: string; name: string; available: boolean };
  credentials: Record<string, string>;
  projectName: string | null;
  organizationName: string | null;
  prefLive: boolean;
  prefFollowup: boolean;
  calendarConnected: boolean;
  calendarProvider: string | null;
  calendarAutojoinPolicy: "all" | "host_only" | "off";
  slackConnected: boolean;
  slackTeamName: string | null;
}

type TabId = "tool" | "calendar" | "slack" | "preferences" | "meetings";

export default function Dashboard() {
  const [conn, setConn] = useState<ConnectionInfo | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [tab, setTab] = useState<TabId>("meetings");
  const [oauthBanner, setOauthBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function load() {
    const [c, m] = await Promise.all([
      fetch("/api/connection"),
      fetch("/api/recall/bot"),
    ]);
    if (c.ok) setConn(await c.json());
    if (m.ok) {
      const j = await m.json();
      setMeetings(j.meetings ?? []);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 4_000);
    return () => clearInterval(t);
  }, []);

  // Restore + persist tab in URL hash for deep-linking and refresh.
  useEffect(() => {
    const fromHash = window.location.hash.replace("#", "") as TabId;
    if (TAB_IDS.includes(fromHash)) setTab(fromHash);

    // OAuth return markers — focus the relevant tab + show a success toast.
    const params = new URLSearchParams(window.location.search);
    const phOk = params.get("posthog") === "connected";
    const phErr = params.get("posthog_oauth_error");
    if (phOk) {
      setTab("tool");
      setOauthBanner({ kind: "ok", text: "PostHog connected via SSO. The same token now powers your follow-ups." });
    } else if (phErr) {
      setTab("tool");
      setOauthBanner({ kind: "err", text: `PostHog sign-in didn't complete: ${phErr}` });
    }
    if (phOk || phErr) {
      const url = new URL(window.location.href);
      url.searchParams.delete("posthog");
      url.searchParams.delete("posthog_oauth_error");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${tab}`);
  }, [tab]);

  if (!conn) {
    return (
      <AppShell showAppNav>
        <div className="mx-auto max-w-5xl px-6 py-12 text-stone-500">Loading…</div>
      </AppShell>
    );
  }

  return (
    <AppShell
      showAppNav
      user={{ name: conn.userName, company: conn.userCompany, email: conn.userEmail }}
      isPartner={conn.isPartner}
    >
      <div className="mx-auto max-w-5xl px-6 py-8">
        {oauthBanner && (
          <div
            className={`mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
              oauthBanner.kind === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100"
                : "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-100"
            }`}
          >
            <div className="flex items-center gap-2">
              <span aria-hidden>{oauthBanner.kind === "ok" ? "✓" : "✗"}</span>
              <span className="font-medium">{oauthBanner.text}</span>
            </div>
            <button
              onClick={() => setOauthBanner(null)}
              className="rounded px-2 py-0.5 text-xs opacity-70 transition hover:opacity-100"
              aria-label="Dismiss"
            >
              Dismiss
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <ProgressNav tab={tab} setTab={setTab} conn={conn} />
          </div>
          <a
            href="https://chat.whatsapp.com/KjyBAVdBpG95pz4xegnjnu?mode=gi_t"
            target="_blank"
            rel="noopener noreferrer"
            title="Help shape DataDonkey on WhatsApp"
            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-950/70"
          >
            <span aria-hidden="true">💬</span>
            <span className="hidden sm:inline">Help build this on WhatsApp</span>
            <span className="sm:hidden">WhatsApp</span>
          </a>
        </div>
        <PipelineBanner meetings={meetings} onDismiss={load} />
        <QuickInviteBar conn={conn} onChange={load} />
        <div className="mt-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {tab === "meetings" && (
                <MeetingsTab
                  conn={conn}
                  meetings={meetings}
                  onChange={load}
                />
              )}
              {tab === "tool" && <ToolTab conn={conn} onChange={load} />}
              {tab === "calendar" && <CalendarTab conn={conn} onChange={load} />}
              {tab === "slack" && <SlackTab conn={conn} onChange={load} />}
              {tab === "preferences" && <PreferencesTab conn={conn} onChange={load} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </AppShell>
  );
}

// ----------- nav -----------

const TAB_IDS: TabId[] = ["tool", "calendar", "slack", "preferences", "meetings"];

function ProgressNav({
  tab,
  setTab,
  conn,
}: {
  tab: TabId;
  setTab: (t: TabId) => void;
  conn: ConnectionInfo;
}) {
  const items: {
    id: TabId;
    label: string;
    done: boolean;
    iconSrc?: string;
  }[] = [
    {
      id: "tool",
      label: conn.connected ? `${conn.provider.name} connected` : `Connect ${conn.provider.name}`,
      done: conn.connected,
      iconSrc: conn.provider.id === "posthog" ? "/posthogicon.png" : undefined,
    },
    {
      id: "calendar",
      label: "Calendar",
      done: conn.calendarConnected,
      iconSrc: "/googlecal.png",
    },
    {
      id: "slack",
      label: "Slack",
      done: conn.slackConnected,
      iconSrc: "/slackicon.png",
    },
    {
      id: "preferences",
      label: "Preferences",
      done: conn.prefLive || conn.prefFollowup,
    },
    { id: "meetings", label: "Meetings", done: true },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-full border border-stone-200 bg-white p-1.5 dark:border-stone-800 dark:bg-stone-900">
      {items.map((it) => {
        const active = it.id === tab;
        return (
          <button
            key={it.id}
            onClick={() => setTab(it.id)}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition ${
              active
                ? "bg-stone-900 text-stone-50 dark:bg-stone-100 dark:text-stone-900"
                : "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
            }`}
          >
            <span
              className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                it.done
                  ? active
                    ? "bg-stone-50 text-stone-900 dark:bg-stone-900 dark:text-stone-100"
                    : "bg-emerald-500 text-white"
                  : active
                    ? "border border-stone-50 text-stone-50 dark:border-stone-900 dark:text-stone-900"
                    : "border border-stone-300 text-stone-400 dark:border-stone-700"
              }`}
            >
              {it.done ? "✓" : "·"}
            </span>
            {it.iconSrc && (
              <img src={it.iconSrc} alt="" className="h-3.5 w-3.5 object-contain" />
            )}
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function QuickInviteBar({ conn, onChange }: { conn: ConnectionInfo; onChange: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const platform = detectPlatform(url);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!url) return;
    setBusy(true);
    const r = await fetch("/api/recall/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingUrl: url }),
    });
    setBusy(false);
    if (r.ok) {
      setUrl("");
      onChange();
    }
  }

  return (
    <form onSubmit={send} className="mt-4 flex gap-2">
      <div className="relative flex-1">
        <input
          type="url"
          placeholder="Quick invite — paste a Meet, Teams, or Zoom link…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full rounded-full border border-stone-200 bg-white px-4 py-2 pr-24 text-sm focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-100"
        />
        {platform !== "unknown" && url && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300">
            {platform}
          </span>
        )}
      </div>
      {url && (
        <button
          type="submit"
          disabled={busy || !conn.connected}
          className="rounded-full bg-orange-600 px-5 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
        >
          {busy ? "Joining…" : "Join"}
        </button>
      )}
    </form>
  );
}

// ----------- meetings tab (main) -----------

function MeetingsTab({
  conn,
  meetings,
  onChange,
}: {
  conn: ConnectionInfo;
  meetings: Meeting[];
  onChange: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = meetings.filter((m) => !isTerminal(m));
  const past = meetings.filter(isTerminal);
  const inCall = active.some((m) => m.status === "in_call");
  const platform = detectPlatform(url);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/recall/bot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingUrl: url }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json();
      setError(j.error ?? "Failed");
      return;
    }
    setUrl("");
    onChange();
  }

  return (
    <div>
      {/* Status indicator */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <motion.span
          className={`inline-flex h-2.5 w-2.5 rounded-full ${
            inCall ? "bg-emerald-500" : "bg-stone-300 dark:bg-stone-700"
          }`}
          animate={inCall ? { opacity: [1, 0.4, 1] } : { opacity: 1 }}
          transition={inCall ? { duration: 1.4, repeat: Infinity } : { duration: 0 }}
        />
        <span className="text-sm font-medium">
          {inCall ? "DataDonkey is in a call" : "DataDonkey is snoozing"}
        </span>
        {!inCall && (
          <span className="text-xs text-stone-500">
            (invite to a meeting to wake!)
          </span>
        )}
        {active.length > 1 && (
          <span className="text-xs text-stone-500">+{active.length - 1} more dispatched</span>
        )}
      </div>

      {/* Hero: invite DataDonkey to a call. This is the main action — bigger,
          orange CTA, gradient background. */}
      <form
        onSubmit={send}
        className="relative mt-6 overflow-hidden rounded-2xl border-2 border-orange-500/30 bg-gradient-to-br from-orange-50 via-amber-50 to-rose-50 p-6 shadow-sm dark:border-orange-500/20 dark:from-orange-950/20 dark:via-amber-950/10 dark:to-rose-950/10 sm:p-8"
      >
        <div className="absolute -right-8 -top-8 h-32 w-32 rotate-12 rounded-full bg-orange-200/40 blur-3xl dark:bg-orange-500/10" />
        <div className="relative">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-orange-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              Main action
            </span>
            <span className="text-xs text-stone-500">supports</span>
            <PlatformIcons />
          </div>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100 sm:text-3xl">
            Invite DataDonkey to a meeting
          </h2>
          <p className="mt-1.5 text-sm text-stone-600 dark:text-stone-400">
            Drop in a Google Meet, Teams, or Zoom link — DataDonkey joins,
            listens, and follows up with the data that matters.
          </p>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <input
                type="url"
                placeholder="Paste your meeting link here…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full rounded-xl border-2 border-stone-200 bg-white px-4 py-4 pr-24 text-base font-medium shadow-sm focus:border-orange-500 focus:outline-none focus:ring-4 focus:ring-orange-200/60 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
                required
              />
              {platform !== "unknown" && url && (
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                  {platform}
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={busy || !conn.connected}
              className="shrink-0 rounded-xl bg-orange-600 px-6 py-4 text-base font-semibold text-white shadow-md transition hover:bg-orange-700 hover:shadow-lg disabled:opacity-50 sm:py-4"
            >
              {busy ? "Dispatching…" : "Send DataDonkey →"}
            </button>
          </div>
          {!conn.connected && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
              Connect {conn.provider.name} first (Tool tab) to dispatch the bot.
            </p>
          )}
          {error && (
            <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
          {conn.prefLive && (
            <p className="mt-3 text-xs text-stone-500">
              Once joined, anyone can say{" "}
              <code className="rounded bg-stone-100 px-1 py-0.5 font-mono dark:bg-stone-800">
                Hey {conn.provider.name}, …
              </code>{" "}
              in the call to ask a question.
            </p>
          )}
        </div>
      </form>

      <HowItWorks providerName={conn.provider.name} />

      {/* Upcoming events from calendar (only if connected) */}
      {conn.calendarConnected && (
        <UpcomingEvents conn={conn} />
      )}

      {/* Active meetings (live + still-joining) */}
      {active.length > 0 && (
        <div className="mt-8">
          <h3 className="text-xs uppercase tracking-widest text-stone-500">
            Active in DataDonkey
          </h3>
          <div className="mt-3 space-y-3">
            {active.map((m) => (
              <MeetingCardWithRemove key={m.id} m={m} onChange={onChange} />
            ))}
          </div>
        </div>
      )}

      {/* Past sessions, grouped by day */}
      <div className="mt-8">
        <h3 className="text-xs uppercase tracking-widest text-stone-500">
          Past sessions{" "}
          <span className="text-stone-400">({past.length})</span>
        </h3>
        <div className="mt-3 space-y-6">
          {past.length === 0 && (
            <div className="rounded-lg border border-dashed border-stone-300 bg-white px-6 py-12 text-center text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-900">
              No past sessions yet.
            </div>
          )}
          {groupByDay(past).map((g) => (
            <section key={g.label}>
              <h4 className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
                {g.label}{" "}
                <span className="ml-1 font-normal normal-case text-stone-400">
                  · {g.dateLabel}
                </span>
              </h4>
              <div className="mt-2 space-y-3">
                {g.meetings.map((m) => (
                  <MeetingCard key={m.id} m={m} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

interface DayGroup {
  label: string; // "Today" | "Yesterday" | "Mon"
  dateLabel: string; // "May 6, 2026"
  meetings: Meeting[];
}

function groupByDay(meetings: Meeting[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  const dayMs = 24 * 60 * 60 * 1000;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const m of meetings) {
    const d = new Date(m.createdAt);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const key = String(dayStart);
    if (!groups.has(key)) {
      const offset = (today - dayStart) / dayMs;
      const label =
        offset === 0
          ? "Today"
          : offset === 1
            ? "Yesterday"
            : offset > 0 && offset < 7
              ? d.toLocaleDateString(undefined, { weekday: "long" })
              : d.toLocaleDateString(undefined, { weekday: "short" });
      const dateLabel = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: dayStart < today - 365 * dayMs ? "numeric" : undefined,
      });
      groups.set(key, { label, dateLabel, meetings: [] });
    }
    groups.get(key)!.meetings.push(m);
  }
  // Sort groups newest first
  return Array.from(groups.entries())
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([, g]) => g);
}

interface UpcomingEvent {
  id: string;
  summary: string;
  meetingUrl: string | null;
  start: string | null;
  end: string | null;
  attendees: { email: string | null; name: string | null }[];
  skip: boolean;
  dispatched: boolean;
  meetingId: string | null;
}

function UpcomingEvents({ conn }: { conn: ConnectionInfo }) {
  const [events, setEvents] = useState<UpcomingEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/calendar/upcoming");
      const j = await r.json();
      if (j.events) setEvents(j.events as UpcomingEvent[]);
      if (j.error) setError(j.error);
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  async function toggle(eventId: string, currentSkip: boolean) {
    setEvents((prev) =>
      prev?.map((e) => (e.id === eventId ? { ...e, skip: !currentSkip } : e)) ?? null,
    );
    await fetch("/api/calendar/upcoming", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, skip: !currentSkip }),
    });
  }

  if (events === null) return null;
  if (error) {
    return (
      <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
        Couldn&apos;t reach Google Calendar — try reconnecting.
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="mt-8">
        <h3 className="text-xs uppercase tracking-widest text-stone-500">
          Upcoming on your calendar
        </h3>
        <div className="mt-2 rounded-lg border border-dashed border-stone-300 bg-white px-6 py-8 text-center text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-900">
          No upcoming meetings with a video link in the next 7 days.
        </div>
      </div>
    );
  }

  // Group upcoming by day too
  const grouped = groupUpcomingByDay(events);

  return (
    <div className="mt-8">
      <h3 className="text-xs uppercase tracking-widest text-stone-500">
        Upcoming on your calendar
      </h3>
      <p className="mt-1 text-xs text-stone-500">
        {conn.provider.name} will join meetings with a video link unless you
        opt out below.
      </p>
      <div className="mt-3 space-y-5">
        {grouped.map((g) => (
          <section key={g.label}>
            <h4 className="text-[11px] font-semibold uppercase tracking-widest text-stone-500">
              {g.label}
              <span className="ml-2 font-normal normal-case text-stone-400">
                · {g.dateLabel}
              </span>
            </h4>
            <div className="mt-2 space-y-2">
              {g.events.map((e) => (
                <UpcomingEventRow key={e.id} ev={e} onToggle={toggle} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function groupUpcomingByDay(
  events: UpcomingEvent[],
): { label: string; dateLabel: string; events: UpcomingEvent[] }[] {
  const groups = new Map<string, { label: string; dateLabel: string; events: UpcomingEvent[] }>();
  const dayMs = 24 * 60 * 60 * 1000;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  for (const ev of events) {
    if (!ev.start) continue;
    const d = new Date(ev.start);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const key = String(dayStart);
    if (!groups.has(key)) {
      const offset = (dayStart - today) / dayMs;
      const label =
        offset === 0
          ? "Today"
          : offset === 1
            ? "Tomorrow"
            : d.toLocaleDateString(undefined, { weekday: "long" });
      const dateLabel = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      groups.set(key, { label, dateLabel, events: [] });
    }
    groups.get(key)!.events.push(ev);
  }
  return Array.from(groups.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, g]) => g);
}

function UpcomingEventRow({
  ev,
  onToggle,
}: {
  ev: UpcomingEvent;
  onToggle: (id: string, skip: boolean) => void;
}) {
  const time = ev.start
    ? new Date(ev.start).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const willJoin = !ev.skip && !ev.dispatched;
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 transition ${
        ev.skip
          ? "border-stone-200 bg-stone-50 opacity-70 dark:border-stone-800 dark:bg-stone-900/50"
          : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
      }`}
    >
      <div className="w-16 shrink-0 text-sm font-mono text-stone-600 dark:text-stone-400">
        {time}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
          {ev.summary}
        </div>
        {ev.attendees.length > 0 && (
          <div className="mt-0.5 truncate text-xs text-stone-500">
            {ev.attendees
              .map((a) => a.name ?? a.email ?? "?")
              .slice(0, 4)
              .join(", ")}
            {ev.attendees.length > 4 && ` +${ev.attendees.length - 4} more`}
          </div>
        )}
      </div>
      {ev.dispatched ? (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
          Dispatched
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onToggle(ev.id, ev.skip)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
            willJoin
              ? "border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-stone-300 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
          }`}
        >
          {willJoin ? "Will join" : "Skip"}
        </button>
      )}
    </div>
  );
}

function MeetingCardWithRemove({
  m,
  onChange,
}: {
  m: Meeting;
  onChange: () => void;
}) {
  const [removing, setRemoving] = useState(false);
  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Pull DataDonkey out of this meeting?")) return;
    setRemoving(true);
    await fetch(`/api/recall/bot/${m.id}/leave`, { method: "POST" });
    setRemoving(false);
    onChange();
  }
  return (
    <div className="relative">
      <MeetingCard m={m} />
      <button
        type="button"
        onClick={remove}
        disabled={removing}
        className="absolute right-3 top-3 rounded-full border border-stone-300 bg-white px-2.5 py-0.5 text-[11px] font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
      >
        {removing ? "…" : "Remove bot"}
      </button>
    </div>
  );
}

function HowItWorks({ providerName }: { providerName: string }) {
  const steps: { color: string; rotate: string; title: string; body: string }[] = [
    {
      color: "bg-emerald-300",
      rotate: "-rotate-3",
      title: "Drop a link",
      body: "Paste your Meet, Teams, or Zoom URL below.",
    },
    {
      color: "bg-amber-300",
      rotate: "rotate-2",
      title: "Bot joins",
      body: `Joins as "${providerName}" and posts a hello in chat.`,
    },
    {
      color: "bg-rose-300",
      rotate: "-rotate-2",
      title: "Ask away",
      body: `Anyone says "Hey ${providerName}, …" — answer lands in chat in seconds.`,
    },
    {
      color: "bg-emerald-300",
      rotate: "rotate-3",
      title: "Get the follow-up",
      body: "Email summary with the data questions you missed, after the call.",
    },
  ];
  return (
    <section className="mt-6 rounded-xl border border-stone-200 bg-amber-50/40 p-6 dark:border-stone-800 dark:bg-amber-950/10">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
        How it works
      </h3>
      <ol className="relative mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${s.color} ${s.rotate} text-sm font-bold text-stone-900 shadow-sm`}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="pt-0.5">
              <span className="block text-sm font-semibold text-stone-900 dark:text-stone-100">
                {s.title}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-stone-600 dark:text-stone-400">
                {s.body}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PlatformIcons() {
  // Official multi-color brand marks served from /public.
  const icons: { src: string; alt: string; tooltip: string }[] = [
    { src: "/meet-icon.svg", alt: "Google Meet", tooltip: "Google Meet" },
    { src: "/teams-icon.svg", alt: "Microsoft Teams", tooltip: "Microsoft Teams" },
    { src: "/zoom-icon.svg", alt: "Zoom", tooltip: "Zoom" },
  ];
  return (
    <span className="inline-flex items-center gap-2">
      {icons.map((i) => (
        <img
          key={i.alt}
          src={i.src}
          alt={i.alt}
          title={i.tooltip}
          className="h-5 w-5 object-contain"
        />
      ))}
    </span>
  );
}

function MeetingCard({ m }: { m: Meeting }) {
  const platform = detectPlatform(m.meetingUrl);
  const finished = isTerminal(m);
  const followedUp = m.questions.length > 0 || finished; // proxy until we expose followupsAt
  return (
    <a
      href={`/dashboard/${m.id}`}
      className="block rounded-lg border border-stone-200 bg-white p-4 transition hover:border-stone-300 hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-900 dark:hover:bg-stone-800/60"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-700 dark:bg-stone-800 dark:text-stone-300">
              {platform}
            </span>
            <span className="text-xs text-stone-500">
              {new Date(m.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-stone-600 dark:text-stone-400">
            {m.meetingUrl}
          </div>
        </div>
        <StatusBadge meeting={m} />
      </div>

      <div className="mt-2">
        <PipelineTimeline
          stages={parsePipelineStages(m.pipelineStages)}
          currentStage={derivePipelineStage(m)}
          size="sm"
        />
      </div>

      {m.questions.length > 0 && (
        <ul className="mt-3 space-y-2 border-t border-stone-100 pt-3 dark:border-stone-800">
          {m.questions.slice(0, 2).map((q) => (
            <li key={q.id} className="text-sm">
              <span className="text-stone-500">{q.askerName ?? "?"}: </span>
              <span className="text-stone-900 dark:text-stone-100">{q.question}</span>
            </li>
          ))}
          {m.questions.length > 2 && (
            <li className="text-xs text-stone-500">
              + {m.questions.length - 2} more
            </li>
          )}
        </ul>
      )}
    </a>
  );
}

function StatusBadge({ meeting }: { meeting: Meeting }) {
  const status = meeting.status;
  if (status === "in_call") {
    return (
      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
        Live
      </span>
    );
  }
  if (status === "joining") {
    return (
      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-300">
        Joining…
      </span>
    );
  }
  // finished — distinguish followed-up vs not based on whether we logged
  // questions during the call. Real "followed up via email" check could
  // also use followupsAt from the Meeting row once we surface it.
  if (meeting.questions.length > 0) {
    return (
      <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300">
        Finished · Followed up
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-400">
      Finished · No follow-ups
    </span>
  );
}

// ----------- secondary tabs -----------

function ToolTab({
  conn,
  onChange,
}: {
  conn: ConnectionInfo;
  onChange: () => void;
}) {
  const isPosthog = conn.provider.id === "posthog";
  const iconSrc = isPosthog ? "/posthogicon.png" : null;
  const projectId = conn.credentials?.projectId;
  const region = conn.credentials?.host?.includes("eu.posthog.com")
    ? "EU"
    : conn.credentials?.host?.includes("us.posthog.com")
      ? "US"
      : conn.credentials?.host
        ? "Self-hosted"
        : null;
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  async function disconnect() {
    setDisconnecting(true);
    try {
      await fetch("/api/connection", { method: "DELETE" });
      onChange();
    } finally {
      setDisconnecting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-start gap-4">
        {iconSrc && (
          <img
            src={iconSrc}
            alt=""
            className="h-12 w-12 shrink-0 rounded-lg border border-stone-200 bg-white p-1.5 dark:border-stone-800 dark:bg-stone-800"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              {conn.provider.name}
            </h2>
            {conn.connected ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12 2l2.39 4.84L20 8l-3.84 3.74L17.78 18 12 15.27 6.22 18l1.62-6.26L4 8l5.61-1.16L12 2z" />
                </svg>
                Verified
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-300">
                Not connected
              </span>
            )}
          </div>
          {conn.connected && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-stone-600 dark:text-stone-400">
              {conn.projectName && (
                <span className="font-semibold text-stone-900 dark:text-stone-100">
                  {conn.projectName}
                </span>
              )}
              {projectId && (
                <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-600 dark:bg-stone-800 dark:text-stone-400">
                  #{projectId}
                </span>
              )}
              {conn.organizationName && (
                <>
                  <span className="text-stone-400">·</span>
                  <span>{conn.organizationName}</span>
                </>
              )}
              {region && (
                <>
                  <span className="text-stone-400">·</span>
                  <span className="text-[11px] uppercase tracking-wider text-stone-500">
                    {region}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        {conn.connected && (
          <div className="flex shrink-0 items-center gap-2">
            <a
              href="/onboarding/connect"
              className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
            >
              Reconnect
            </a>
            {!confirming ? (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900/40 dark:bg-stone-900 dark:text-red-300 dark:hover:bg-red-950/30"
              >
                Disconnect
              </button>
            ) : (
              <div className="flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1 dark:border-red-900/40 dark:bg-red-950/30">
                <span className="text-xs text-red-800 dark:text-red-200">
                  Sure?
                </span>
                <button
                  type="button"
                  onClick={disconnect}
                  disabled={disconnecting}
                  className="rounded bg-red-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {disconnecting ? "…" : "Yes"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={disconnecting}
                  className="rounded px-2 py-0.5 text-xs text-red-800 hover:bg-red-100 disabled:opacity-50 dark:text-red-200 dark:hover:bg-red-900/40"
                >
                  No
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Inline reconnect UI when disconnected — same dual-path as onboarding */}
      {!conn.connected && isPosthog && (
        <div className="mt-5 rounded-lg border border-orange-200 bg-orange-50/60 p-5 dark:border-orange-900/40 dark:bg-orange-950/20">
          <h3 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            Reconnect your data tool
          </h3>
          <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">
            Until you reconnect, DataDonkey can&apos;t answer data questions or
            send follow-ups.
          </p>
          <div className="mt-4">
            <PosthogConnectButton
              href="/api/oauth/posthog/start?return=/dashboard"
              comingSoon={false}
              badge="~5x faster"
            />
            <p className="mt-2 text-center text-[11px] text-stone-500 dark:text-stone-400">
              One click — works with SSO/SAML. No keys to copy.
            </p>
          </div>
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
            <span className="text-[11px] uppercase tracking-wider text-stone-400">
              Or the longer way
            </span>
            <div className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
          </div>
          <a
            href="/onboarding/connect"
            className="block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-center text-sm font-medium text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
          >
            Use a Personal API Key →
          </a>
        </div>
      )}

      {/* What this means — DataDonkey's role */}
      <div className="mt-6 rounded-lg border border-stone-100 bg-amber-50/60 p-4 dark:border-stone-800 dark:bg-amber-950/10">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
          We&apos;re just the carrier
        </h3>
        <ul className="mt-3 space-y-2 text-sm text-stone-700 dark:text-stone-300">
          <li className="flex gap-2">
            <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            <span>
              Your data <strong>stays in {conn.provider.name}</strong>. DataDonkey
              never stores it — we read what&apos;s needed and forget.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            <span>
              We bring the right data to <strong>where decisions happen</strong>{" "}
              — your meetings, Slack, email — not behind a login screen.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            <span>
              Powered by {conn.provider.name}&apos;s official MCP server. Same
              read-only scopes as a Personal API Key — auditable in your{" "}
              {conn.provider.name} settings, revocable anytime.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function CalendarTab({ conn, onChange }: { conn: ConnectionInfo; onChange: () => void }) {
  const [policy, setPolicy] = useState<"all" | "host_only" | "off">(
    conn.calendarAutojoinPolicy ?? "all",
  );
  const [saving, setSaving] = useState(false);

  async function disconnect() {
    await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calendarConnected: false,
        calendarProvider: null,
      }),
    });
    onChange();
  }

  async function setAutojoin(p: "all" | "host_only" | "off") {
    setPolicy(p);
    setSaving(true);
    try {
      await fetch("/api/connection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarAutojoinPolicy: p }),
      });
      onChange();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Calendar">
      <p className="text-sm text-stone-700 dark:text-stone-300">
        Auto-join meetings on your calendar. We only read events with a meeting link.
      </p>
      {conn.calendarConnected ? (
        <>
          <div className="mt-4 flex items-center gap-3">
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
              Connected · {conn.calendarProvider}
            </span>
            <button
              onClick={disconnect}
              className="text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-200"
            >
              Disconnect
            </button>
          </div>

          <div className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900/40">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-stone-500">
              Auto-join policy
            </h3>
            <div className="mt-3 space-y-2">
              <PolicyOption
                value="all"
                current={policy}
                onSelect={setAutojoin}
                disabled={saving}
                title="Join all my meetings"
                desc="DataDonkey joins every event with a meeting link."
              />
              <PolicyOption
                value="host_only"
                current={policy}
                onSelect={setAutojoin}
                disabled={saving}
                title="Only meetings I'm hosting"
                desc="Joins when you're the organizer. Skips invites you accepted."
              />
              <PolicyOption
                value="off"
                current={policy}
                onSelect={setAutojoin}
                disabled={saving}
                title="Disable auto-join"
                desc="DataDonkey won't auto-join. You can still invite it manually."
              />
            </div>
          </div>
        </>
      ) : (
        <div className="mt-4">
          <a
            href="/api/oauth/google/start"
            className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
          >
            <img src="/googlecal.png" alt="" className="h-4 w-4 object-contain" />
            Connect Google Calendar
          </a>
        </div>
      )}
    </Card>
  );
}

function PolicyOption({
  value,
  current,
  onSelect,
  disabled,
  title,
  desc,
}: {
  value: "all" | "host_only" | "off";
  current: "all" | "host_only" | "off";
  onSelect: (v: "all" | "host_only" | "off") => void;
  disabled: boolean;
  title: string;
  desc: string;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(value)}
      className={`flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
        selected
          ? "border-orange-400 bg-orange-50 dark:border-orange-600 dark:bg-orange-950/30"
          : "border-stone-200 bg-white hover:border-stone-300 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700"
      } disabled:opacity-60`}
    >
      <span
        className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          selected
            ? "border-orange-500 bg-orange-500"
            : "border-stone-300 bg-white dark:border-stone-600 dark:bg-stone-800"
        }`}
      >
        {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-stone-900 dark:text-stone-100">
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-stone-600 dark:text-stone-400">
          {desc}
        </span>
      </span>
    </button>
  );
}

function SlackTab({ conn, onChange }: { conn: ConnectionInfo; onChange: () => void }) {
  async function disconnect() {
    await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slackConnected: false,
        slackTeamName: null,
      }),
    });
    onChange();
  }

  return (
    <Card title="Slack">
      <p className="text-sm text-stone-700 dark:text-stone-300">
        DM you the post-call follow-up so you can share it with your team.
      </p>
      {conn.slackConnected ? (
        <div className="mt-4 flex items-center gap-3">
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
            Connected · {conn.slackTeamName ?? "workspace"}
          </span>
          <button
            onClick={disconnect}
            className="text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-200"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <a
          href="/api/oauth/slack/start"
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
        >
          <img src="/slackicon.png" alt="" className="h-4 w-4 object-contain" />
          Connect Slack
        </a>
      )}
    </Card>
  );
}

function PreferencesTab({ conn, onChange }: { conn: ConnectionInfo; onChange: () => void }) {
  const [live, setLive] = useState(conn.prefLive);
  const [followup, setFollowup] = useState(conn.prefFollowup);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLive(conn.prefLive);
    setFollowup(conn.prefFollowup);
  }, [conn.prefLive, conn.prefFollowup]);

  async function update(which: "live" | "followup") {
    const next = which === "live" ? !live : !followup;
    if (which === "live" && !next && !followup) {
      setError("At least one preference must be enabled");
      return;
    }
    if (which === "followup" && !next && !live) {
      setError("At least one preference must be enabled");
      return;
    }
    setError(null);
    if (which === "live") setLive(next);
    else setFollowup(next);
    await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        which === "live" ? { prefLive: next } : { prefFollowup: next },
      ),
    });
    onChange();
  }

  return (
    <Card title="Preferences">
      <div className="space-y-4">
        <SmartFollowsCard
          checked={followup}
          onChange={() => update("followup")}
          providerName={conn.provider.name}
        />
        <PrefRow
          checked={live}
          onChange={() => update("live")}
          title={`"Hey ${conn.provider.name}" — answer live in calls`}
          subtitle="Reply in chat in 5–10s when someone uses the wake word."
          badge="Available, but not great yet"
        />
      </div>
      {error && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
    </Card>
  );
}

function SmartFollowsCard({
  checked,
  onChange,
  providerName,
}: {
  checked: boolean;
  onChange: () => void;
  providerName: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border-2 p-5 transition ${
        checked
          ? "border-orange-500/50 bg-gradient-to-br from-orange-50 to-amber-50 dark:border-orange-500/30 dark:from-orange-950/20 dark:to-amber-950/10"
          : "border-stone-200 dark:border-stone-800"
      }`}
    >
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={onChange}
          className={`mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            checked ? "bg-orange-600" : "bg-stone-300 dark:bg-stone-700"
          }`}
          aria-pressed={checked}
        >
          <motion.span
            animate={{ x: checked ? 22 : 2 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="inline-block h-5 w-5 rounded-full bg-white shadow-md"
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-stone-900 dark:text-stone-100">
              Smart fast follows
            </h3>
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
              Recommended
            </span>
          </div>
          <p className="mt-2 text-sm text-stone-700 dark:text-stone-300">
            DataDonkey listens to your meetings and, after, sends you a private
            briefing of the data questions that came up — answered with real
            numbers from {providerName}.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-stone-200 bg-white/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
              <div className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                What it&apos;s trained on
              </div>
              <ul className="mt-1.5 space-y-1 text-xs text-stone-600 dark:text-stone-400">
                <li>• Spotting data questions, asked or not</li>
                <li>• Picking the right metric without being told</li>
                <li>• Strategic reasoning over your event taxonomy</li>
                <li>• Surfacing things you&apos;d miss otherwise</li>
              </ul>
            </div>
            <div className="rounded-lg border border-stone-200 bg-white/70 p-3 dark:border-stone-800 dark:bg-stone-900/50">
              <div className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                What you get
              </div>
              <ul className="mt-1.5 space-y-1 text-xs text-stone-600 dark:text-stone-400">
                <li>• Email + Slack DM after each call</li>
                <li>• Bottom-line-up-front findings</li>
                <li>• Footnotes on events &amp; assumptions used</li>
                <li>• Links straight to the {providerName} chart</li>
              </ul>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-dashed border-stone-300 bg-white/50 p-3 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-900/30 dark:text-stone-400">
            <span className="font-medium text-stone-900 dark:text-stone-100">
              Example —
            </span>{" "}
            you and your designer brainstorm a new onboarding flow. After the
            call, DataDonkey digs into your funnel data and shares an actionable
            finding: where users actually drop off today, and which step would
            move the needle most. Helping you build something people want.
          </div>
        </div>
      </div>
    </div>
  );
}

function PrefRow({
  checked,
  onChange,
  title,
  subtitle,
  badge,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  subtitle: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`flex w-full items-start gap-4 rounded-lg border px-4 py-3 text-left transition ${
        checked
          ? "border-stone-900 bg-stone-100 dark:border-stone-100 dark:bg-stone-800"
          : "border-stone-200 hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700"
      }`}
    >
      <span
        className={`mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-stone-900 dark:bg-stone-100" : "bg-stone-300 dark:bg-stone-700"
        }`}
      >
        <motion.span
          animate={{ x: checked ? 18 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="inline-block h-4 w-4 rounded-full bg-white shadow-sm"
        />
      </span>
      <span className="flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-stone-900 dark:text-stone-100">
            {title}
          </span>
          {badge && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-300">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-stone-600 dark:text-stone-400">
          {subtitle}
        </span>
      </span>
    </button>
  );
}

// ----------- pipeline banner / timeline -----------

function PipelineBanner({
  meetings,
  onDismiss,
}: {
  meetings: Meeting[];
  onDismiss: () => void;
}) {
  // Pick the most relevant meeting for the banner: in-call > pipeline-active > nothing
  const active = pickActiveMeeting(meetings);
  if (!active) return null;
  const derived = derivePipelineStage(active) ?? active.pipelineStage;
  const isLive =
    active.status === "in_call" ||
    active.status === "joining" ||
    derived === "listening";
  const isProcessing =
    !isLive && !!derived && derived !== "done" && derived !== "failed";
  const isDone = derived === "done" || derived === "failed";
  if (isDone && active.pipelineDismissed) return null;

  const participants = parseParticipants(active.participants);
  const title = active.title ?? humanTitleFromUrl(active.meetingUrl) ?? "your meeting";

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative mt-4 overflow-hidden rounded-2xl border-2 p-5 sm:p-6 ${
        isLive
          ? "border-emerald-400/60 bg-gradient-to-br from-emerald-50 via-teal-50 to-emerald-50 shadow-md dark:border-emerald-500/40 dark:from-emerald-950/30 dark:via-teal-950/20 dark:to-emerald-950/30"
          : isDone
            ? "border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900"
            : "border-orange-300 bg-gradient-to-br from-orange-50 via-amber-50 to-orange-50 shadow-md dark:border-orange-500/40 dark:from-orange-950/20 dark:via-amber-950/10 dark:to-orange-950/20"
      }`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="relative flex h-3 w-3">
          {isLive && (
            <motion.span
              animate={{ opacity: [1, 0.3, 1], scale: [1, 1.4, 1] }}
              transition={{ duration: 1.6, repeat: Infinity }}
              className="absolute inset-0 rounded-full bg-emerald-400/60"
            />
          )}
          <span
            className={`relative inline-flex h-3 w-3 rounded-full ${
              isLive ? "bg-emerald-500" : isDone ? "bg-stone-400 dark:bg-stone-600" : "bg-orange-500"
            }`}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-base font-bold text-stone-900 dark:text-stone-100 sm:text-lg">
              {isLive
                ? `DataDonkey is in a meeting with you`
                : isDone
                  ? `Follow-up delivered`
                  : `DataDonkey is wrapping up`}
            </span>
            {isLive && (
              <span className="text-sm text-stone-700 dark:text-stone-300">
                · <strong className="font-semibold">{title}</strong>
              </span>
            )}
          </div>
          {(isLive || isProcessing) && (
            <div className="mt-0.5 text-sm text-stone-600 dark:text-stone-400">
              {isLive && participants.length > 0 && (
                <span>
                  {participants.slice(0, 4).map((p) => p.name).join(", ")}
                  {participants.length > 4 && ` +${participants.length - 4} more`}
                  {" · "}
                </span>
              )}
              {isLive && <LiveDuration startedAt={active.createdAt} />}
              {isProcessing && (
                <span>{STAGE_DESCS[derived ?? ""] ?? "Working…"}</span>
              )}
            </div>
          )}
        </div>
        <a
          href={`/dashboard/${active.id}`}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            isLive
              ? "border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-stone-300 bg-white text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
          }`}
        >
          Open meeting →
        </a>
        {isDone && (
          <button
            type="button"
            onClick={async () => {
              await fetch(`/api/meetings/${active.id}/dismiss`, { method: "POST" });
              onDismiss();
            }}
            className="shrink-0 text-xs text-stone-500 hover:text-stone-900 dark:hover:text-stone-200"
          >
            Dismiss
          </button>
        )}
      </div>

      <PipelineTimeline
        stages={parsePipelineStages(active.pipelineStages)}
        currentStage={derived}
        size="lg"
      />
    </motion.div>
  );
}

function pickActiveMeeting(meetings: Meeting[]): Meeting | null {
  // Priority: in-call > processing > most recent done (un-dismissed)
  const inCall = meetings.find(
    (m) =>
      m.status === "in_call" ||
      m.status === "joining" ||
      m.pipelineStage === "listening",
  );
  if (inCall) return inCall;
  const processing = meetings.find(
    (m) =>
      m.pipelineStage &&
      m.pipelineStage !== "done" &&
      m.pipelineStage !== "failed" &&
      !isTerminalLogical(m),
  );
  // If there's a recently terminated bot still mid-pipeline, surface it.
  if (processing) return processing;
  const recentlyDone = meetings.find(
    (m) =>
      (m.pipelineStage === "done" || m.pipelineStage === "failed") &&
      !m.pipelineDismissed &&
      m.pipelineStageAt &&
      Date.now() - new Date(m.pipelineStageAt).getTime() < 15 * 60_000,
  );
  return recentlyDone ?? null;
}

function isTerminalLogical(m: Meeting): boolean {
  return m.pipelineStage === "done" || m.pipelineStage === "failed";
}

function PipelineTimeline({
  stages,
  currentStage,
  size = "sm",
}: {
  stages: PipelineEntry[];
  currentStage: string | null;
  size?: "sm" | "lg";
}) {
  // Build a row of all known stages, mark which have happened, which is current.
  const seen = new Map<string, PipelineEntry>();
  for (const s of stages) seen.set(s.stage, s);
  const cur = currentStage ?? stages[stages.length - 1]?.stage ?? null;
  const curIdx = cur ? (PIPELINE_STAGES as readonly string[]).indexOf(cur) : -1;

  const lineStyle = size === "lg" ? "py-4" : "py-2";
  const iconStyle = size === "lg" ? "h-7 w-7 text-xs" : "h-5 w-5 text-[10px]";
  const labelStyle = size === "lg" ? "text-xs" : "text-[10px]";

  return (
    <div className={`mt-3 ${lineStyle}`}>
      <div className="flex items-center gap-1 sm:gap-2">
        {PIPELINE_STAGES.map((s, i) => {
          const entry = seen.get(s);
          // Stage counts as "reached" if we have a logged entry for it,
          // OR if cur is set and this stage's index is at or before it
          // (so we render correctly even when stage history is sparse).
          const reached = !!entry || (curIdx >= 0 && i <= curIdx);
          const isCurrent = cur === s && s !== "done";
          const isFuture = !reached;
          return (
            <div key={s} className="flex flex-1 items-center gap-1 sm:gap-2">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`relative flex shrink-0 items-center justify-center rounded-full font-semibold ${iconStyle} ${
                    isCurrent
                      ? "border-2 border-orange-500 bg-white text-orange-600 dark:border-orange-400 dark:bg-stone-950 dark:text-orange-300"
                      : reached
                        ? "bg-emerald-500 text-white"
                        : "border border-stone-300 bg-white text-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-600"
                  }`}
                >
                  {isCurrent ? (
                    <motion.span
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
                      className="inline-block leading-none"
                    >
                      ◐
                    </motion.span>
                  ) : reached ? (
                    "✓"
                  ) : (
                    String(i + 1)
                  )}
                  {isCurrent && (
                    <motion.span
                      animate={{ scale: [1, 1.7], opacity: [0.5, 0] }}
                      transition={{ duration: 1.6, repeat: Infinity }}
                      className="absolute inset-0 rounded-full ring-2 ring-orange-400/60"
                    />
                  )}
                </div>
                {size === "lg" && (
                  <span
                    className={`whitespace-nowrap font-medium ${labelStyle} ${
                      isCurrent
                        ? "text-orange-700 dark:text-orange-300"
                        : reached
                          ? "text-stone-700 dark:text-stone-300"
                          : "text-stone-400"
                    }`}
                  >
                    {STAGE_LABELS[s]}
                  </span>
                )}
              </div>
              {i < PIPELINE_STAGES.length - 1 && (
                <div
                  className={`h-0.5 flex-1 rounded-full ${
                    curIdx > i
                      ? "bg-emerald-400/70 dark:bg-emerald-500/60"
                      : reached
                        ? "bg-emerald-300 dark:bg-emerald-600"
                        : "bg-stone-200 dark:bg-stone-800"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Best-effort current stage when the pipelineStage column is stale or
// missing — derive from the meeting status so the timeline still shows
// something meaningful.
function derivePipelineStage(m: Meeting): string | null {
  if (m.pipelineStage) return m.pipelineStage;
  if (m.status === "joining" || m.status === "in_call") return "listening";
  if (m.status === "done" || m.status === "call_ended" || m.status === "fatal") {
    return m.followupReport ? "done" : m.followupAttempted ? "delivering" : "reviewing";
  }
  return null;
}

function parsePipelineStages(json: string | null): PipelineEntry[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as PipelineEntry[];
  } catch {
    return [];
  }
}

function parseParticipants(json: string | null): { name: string; email?: string | null }[] {
  if (!json) return [];
  try {
    return JSON.parse(json) as { name: string; email?: string | null }[];
  } catch {
    return [];
  }
}

function humanTitleFromUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.host.includes("meet.google")) return "your Meet call";
    if (u.host.includes("zoom")) return "your Zoom call";
    if (u.host.includes("teams.microsoft") || u.host.includes("teams.live")) return "your Teams call";
  } catch {}
  return null;
}

function LiveDuration({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsedMs = now - new Date(startedAt).getTime();
  const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return <span>{m}m {String(s).padStart(2, "0")}s</span>;
}

// ----------- helpers -----------

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900">
      <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function SecondaryAction({
  onClick,
  children,
  className,
}: {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800 ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

function detectPlatform(url: string): "Zoom" | "Teams" | "Meet" | "unknown" {
  if (!url) return "unknown";
  if (/zoom\.us\/|zoomgov\.com\//i.test(url)) return "Zoom";
  if (/teams\.microsoft\.com\/|teams\.live\.com\//i.test(url)) return "Teams";
  if (/meet\.google\.com\//i.test(url)) return "Meet";
  return "unknown";
}

function isTerminal(m: Meeting): boolean {
  return (
    m.endedAt != null ||
    m.status === "done" ||
    m.status === "fatal" ||
    m.status === "call_ended"
  );
}
