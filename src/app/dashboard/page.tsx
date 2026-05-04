"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AppShell } from "@/components/AppShell";

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
  createdAt: string;
  endedAt: string | null;
  questions: Question[];
}

interface ConnectionInfo {
  exists: boolean;
  signedUp: boolean;
  connected: boolean;
  userName: string | null;
  userCompany: string | null;
  userEmail: string | null;
  provider: { id: string; name: string; available: boolean };
  prefLive: boolean;
  prefFollowup: boolean;
  calendarConnected: boolean;
  calendarProvider: string | null;
  slackConnected: boolean;
  slackTeamName: string | null;
}

type TabId = "tool" | "calendar" | "slack" | "preferences" | "meetings";

export default function Dashboard() {
  const [conn, setConn] = useState<ConnectionInfo | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [tab, setTab] = useState<TabId>("meetings");

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
    >
      <div className="mx-auto max-w-5xl px-6 py-8">
        <ProgressNav tab={tab} setTab={setTab} conn={conn} />
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
              {tab === "tool" && <ToolTab conn={conn} />}
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
  const items: { id: TabId; label: string; done: boolean }[] = [
    {
      id: "tool",
      label: conn.connected ? `${conn.provider.name} connected` : `Connect ${conn.provider.name}`,
      done: conn.connected,
    },
    { id: "calendar", label: "Calendar", done: conn.calendarConnected },
    { id: "slack", label: "Slack", done: conn.slackConnected },
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
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
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
      <div className="flex items-center gap-3">
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
        {active.length > 1 && (
          <span className="text-xs text-stone-500">+{active.length - 1} more dispatched</span>
        )}
      </div>

      {/* Send-to-call form */}
      <form
        onSubmit={send}
        className="mt-6 rounded-xl border border-stone-200 bg-white p-6 dark:border-stone-800 dark:bg-stone-900"
      >
        <label className="block">
          <span className="text-sm font-medium">Invite DataDonkey to a meeting</span>
          <span className="ml-2 text-xs text-stone-500">
            Zoom · Microsoft Teams · Google Meet
          </span>
          <div className="mt-2 flex gap-2">
            <div className="relative flex-1">
              <input
                type="url"
                placeholder="https://meet.google.com/abc-defg-hij  ·  https://zoom.us/j/123  ·  https://teams.microsoft.com/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 pr-20 text-sm dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
                required
              />
              {platform !== "unknown" && url && (
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300">
                  {platform}
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={busy || !conn.connected}
              className="shrink-0 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
            >
              {busy ? "Dispatching…" : "Send DataDonkey"}
            </button>
          </div>
        </label>
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
        <p className="mt-3 text-xs text-stone-500">
          Once joined, anyone can say{" "}
          <code className="rounded bg-stone-100 px-1 py-0.5 font-mono dark:bg-stone-800">
            Hey {conn.provider.name}, …
          </code>{" "}
          in the call to ask a question.
        </p>
      </form>

      {/* Active meetings (live + still-joining) */}
      {active.length > 0 && (
        <div className="mt-8">
          <h3 className="text-xs uppercase tracking-widest text-stone-500">Active</h3>
          <div className="mt-3 space-y-3">
            {active.map((m) => (
              <MeetingCard key={m.id} m={m} />
            ))}
          </div>
        </div>
      )}

      {/* Past sessions */}
      <div className="mt-8">
        <h3 className="text-xs uppercase tracking-widest text-stone-500">
          Past sessions{" "}
          <span className="text-stone-400">({past.length})</span>
        </h3>
        <div className="mt-3 space-y-3">
          {past.length === 0 && (
            <div className="rounded-lg border border-dashed border-stone-300 bg-white px-6 py-12 text-center text-sm text-stone-500 dark:border-stone-800 dark:bg-stone-900">
              No past sessions yet.
            </div>
          )}
          {past.map((m) => (
            <MeetingCard key={m.id} m={m} />
          ))}
        </div>
      </div>
    </div>
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

function ToolTab({ conn }: { conn: ConnectionInfo }) {
  return (
    <Card title={`${conn.provider.name} connection`}>
      {conn.connected ? (
        <p className="text-sm text-stone-700 dark:text-stone-300">
          Connected. DataDonkey will query {conn.provider.name} via its MCP server.
        </p>
      ) : (
        <p className="text-sm text-amber-800 dark:text-amber-300">
          Not connected — DataDonkey can&apos;t answer questions until you finish the connection.
        </p>
      )}
      <a
        href="/onboarding/connect"
        className="mt-4 inline-flex rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
      >
        {conn.connected ? "Reconnect" : `Connect ${conn.provider.name}`}
      </a>
    </Card>
  );
}

function CalendarTab({ conn, onChange }: { conn: ConnectionInfo; onChange: () => void }) {
  async function connect(provider: "google" | "microsoft") {
    await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendarConnected: true, calendarProvider: provider }),
    });
    onChange();
  }
  async function disconnect() {
    await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendarConnected: false, calendarProvider: null }),
    });
    onChange();
  }

  return (
    <Card title="Calendar">
      <p className="text-sm text-stone-700 dark:text-stone-300">
        Auto-join meetings on your calendar. We only read events with a meeting link.
      </p>
      {conn.calendarConnected ? (
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
      ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <SecondaryAction onClick={() => connect("google")}>📅 Connect Google Calendar</SecondaryAction>
          <SecondaryAction onClick={() => connect("microsoft")}>📅 Connect Outlook</SecondaryAction>
        </div>
      )}
      <p className="mt-3 text-xs text-stone-500">
        (Mock for prototype — no real OAuth yet. Wire up Google / Microsoft OAuth before launch.)
      </p>
    </Card>
  );
}

function SlackTab({ conn, onChange }: { conn: ConnectionInfo; onChange: () => void }) {
  async function connect() {
    await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slackConnected: true, slackTeamName: "Demo workspace" }),
    });
    onChange();
  }
  async function disconnect() {
    await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slackConnected: false, slackTeamName: null }),
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
        <SecondaryAction onClick={connect} className="mt-4">
          💬 Connect Slack
        </SecondaryAction>
      )}
      <p className="mt-3 text-xs text-stone-500">
        (Mock for prototype — wire up Slack OAuth before launch.)
      </p>
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
      <div className="space-y-3">
        <PrefRow
          checked={live}
          onChange={() => update("live")}
          title={`"Hey ${conn.provider.name}" — answer live in calls`}
          subtitle="Reply in chat in 5–10s when someone uses the wake word."
        />
        <PrefRow
          checked={followup}
          onChange={() => update("followup")}
          title="Smart fast follows"
          subtitle="After each call, surface data questions and email everyone the answers."
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

function PrefRow({
  checked,
  onChange,
  title,
  subtitle,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  subtitle: string;
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
      <span>
        <span className="block text-sm font-medium text-stone-900 dark:text-stone-100">
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-stone-600 dark:text-stone-400">
          {subtitle}
        </span>
      </span>
    </button>
  );
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
