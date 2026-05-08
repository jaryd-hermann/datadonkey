"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import confetti from "canvas-confetti";
import { AppShell } from "@/components/AppShell";
import { PosthogConnectButton } from "@/components/PosthogConnectButton";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

// Fires confetti from the four corners — used to celebrate completing a
// concrete connection (tool, calendar, slack).
function celebrate() {
  if (typeof window === "undefined") return;
  const colors = ["#EA580C", "#F59E0B", "#FBBF24", "#10B981", "#3B82F6"];
  const common = { particleCount: 60, spread: 70, startVelocity: 45, colors, ticks: 200 };
  // Each corner shoots inward
  confetti({ ...common, origin: { x: 0, y: 0 }, angle: -45 });
  confetti({ ...common, origin: { x: 1, y: 0 }, angle: 225 });
  confetti({ ...common, origin: { x: 0, y: 1 }, angle: 45 });
  confetti({ ...common, origin: { x: 1, y: 1 }, angle: 135 });
}

type StepId = "auth" | "tool" | "preferences" | "calendar" | "slack";

const STEPS: { id: StepId; label: string }[] = [
  { id: "auth", label: "Account" },
  { id: "tool", label: "Data tool" },
  { id: "preferences", label: "Preferences" },
  { id: "calendar", label: "Calendar" },
  { id: "slack", label: "Slack" },
];

const TOOLS = [
  { id: "posthog", name: "PostHog", recommended: true, hasOAuth: true, oauthLabel: "Continue with PostHog", available: true, iconSrc: "/posthogicon.png" },
  { id: "mixpanel", name: "Mixpanel", recommended: false, hasOAuth: false, available: false, iconSrc: null },
  { id: "amplitude", name: "Amplitude", recommended: false, hasOAuth: false, available: false, iconSrc: null },
] as const;

type ToolId = (typeof TOOLS)[number]["id"];

interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  helpText?: string;
  required?: boolean;
  regions?: { id: string; label: string; url: string }[];
}

interface ProviderShape {
  id: string;
  name: string;
  available: boolean;
  hasOAuth: boolean;
  oauthLabel?: string;
  credentialFields: CredentialField[];
  setupHint?: string;
}

// Detect OAuth-return markers synchronously on first render so we don't
// show step 0 for a flash while the async mount effect figures out where
// the user should actually land.
function initialStepFromUrl(): number {
  if (typeof window === "undefined") return 0;
  const p = new URLSearchParams(window.location.search);
  if (p.get("posthog") === "connected") {
    return STEPS.findIndex((s) => s.id === "preferences");
  }
  if (p.get("google") === "ok") {
    return STEPS.findIndex((s) => s.id === "calendar");
  }
  if (p.get("slack") === "ok") {
    return STEPS.findIndex((s) => s.id === "slack");
  }
  if (p.get("posthog_oauth_error")) {
    return STEPS.findIndex((s) => s.id === "tool");
  }
  return 0;
}

function hasOAuthMarker(): boolean {
  if (typeof window === "undefined") return false;
  const p = new URLSearchParams(window.location.search);
  return [
    "posthog",
    "google",
    "slack",
    "posthog_oauth_error",
  ].some((k) => p.has(k));
}

export default function Signup() {
  const router = useRouter();
  const [stepIdx, setStepIdx] = useState(initialStepFromUrl);
  const [maxStep, setMaxStep] = useState(initialStepFromUrl);
  const [direction, setDirection] = useState<1 | -1>(1);
  // Hide the wizard for ~one tick when we're returning from an OAuth flow,
  // so the user sees a calm "Finishing setup…" screen instead of step 0
  // briefly flashing before state is reconciled.
  const [bootstrapping, setBootstrapping] = useState(hasOAuthMarker);
  const step = STEPS[stepIdx].id;

  // Step 1 state
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signup");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [orgSize, setOrgSize] = useState("");

  // Step 2 state
  const [tool, setTool] = useState<ToolId>("posthog");
  const [provider, setProvider] = useState<ProviderShape | null>(null);
  const [credValues, setCredValues] = useState<Record<string, string>>({});

  // Step 3 state
  const [prefLive, setPrefLive] = useState(true);
  const [prefFollowup, setPrefFollowup] = useState(true);

  // Step 4 state
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarProvider, setCalendarProvider] = useState<"google" | "microsoft" | null>(null);

  // Step 5 state
  const [slackConnected, setSlackConnected] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  // On mount: if the user is already authed (e.g. they returned from
  // Google OAuth or clicked an email magic link), skip past the auth step
  // and go straight to whichever step is next based on saved progress.
  useEffect(() => {
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const { data: userData } = await supabase.auth.getUser();
      const r = await fetch("/api/connection");
      const j = await r.json();
      if (j.provider) setProvider(j.provider);

      const u = userData.user;
      if (!u) return;

      // Prefill name + email from Google/Supabase identity if we have it.
      // Company isn't in the OAuth payload, so the user still has to type it.
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      const fullName =
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        "";
      if (j.userName) setName(j.userName);
      else if (fullName) setName(String(fullName));
      if (j.userCompany) setCompany(j.userCompany);
      if (j.userEmail) setEmail(j.userEmail);
      else if (u.email) setEmail(u.email);

      // Reflect any persisted connections from the DB so resume-state matches reality.
      if (j.calendarConnected) {
        setCalendarConnected(true);
        if (j.calendarProvider) setCalendarProvider(j.calendarProvider);
      }
      if (j.slackConnected) setSlackConnected(true);

      // Detect return-from-OAuth markers and route the user back to the
      // step they came from, fire confetti, then strip the params.
      const params = new URLSearchParams(window.location.search);
      const googleOk = params.get("google") === "ok";
      const slackOk = params.get("slack") === "ok";
      const posthogOk = params.get("posthog") === "connected";
      const posthogErr = params.get("posthog_oauth_error");
      let landed: number | null = null;
      if (posthogOk) {
        // OAuth flow returned successfully — flag tool as connected and
        // bounce them to preferences (next step after tool).
        const next = STEPS.findIndex((s) => s.id === "preferences");
        landed = next;
        celebrate();
      } else if (posthogErr) {
        setError(`PostHog sign-in didn't work: ${posthogErr}`);
        landed = STEPS.findIndex((s) => s.id === "tool");
      }
      if (googleOk) {
        setCalendarConnected(true);
        setCalendarProvider("google");
        landed = STEPS.findIndex((s) => s.id === "calendar");
        celebrate();
        // Auto-advance to Slack after the confetti settles so the user
        // doesn't have to hit "Continue" themselves.
        const next = STEPS.findIndex((s) => s.id === "slack");
        setTimeout(() => {
          setDirection(1);
          setStepIdx(next);
          setMaxStep((m) => Math.max(m, next));
        }, 1400);
      } else if (slackOk) {
        setSlackConnected(true);
        landed = STEPS.findIndex((s) => s.id === "slack");
        celebrate();
        // Slack is the final step — auto-advance to /dashboard after the
        // confetti so the user lands cleanly in the app.
        setTimeout(() => router.push("/dashboard"), 1600);
      }
      if (googleOk || slackOk || posthogOk || posthogErr) {
        const url = new URL(window.location.href);
        url.searchParams.delete("google");
        url.searchParams.delete("slack");
        url.searchParams.delete("posthog");
        url.searchParams.delete("posthog_oauth_error");
        window.history.replaceState(null, "", url.toString());
      }

      if (landed !== null) {
        setStepIdx(landed);
        setMaxStep((m) => Math.max(m, landed));
      } else if (j.signedUp) {
        // Authed + name/company saved — start at the data tool step.
        setStepIdx(1);
        setMaxStep((m) => Math.max(m, 1));
      }
      // If authed but not signedUp, stay on step 0 so they enter company.
      setBootstrapping(false);
    })();
    // router is stable; intentionally only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When tool changes, fetch its provider shape from server. We do this by
  // POSTing the new tool to the signup endpoint (it persists name/co + tool
  // from step 1), then GETting the connection to read the provider config.
  async function loadProviderForTool(t: ToolId) {
    // Quietly persist current tool selection by hitting POST again. The
    // server's POST validates name+company; we only call this once they've
    // already submitted those.
    if (!name || !company) return;
    await fetch("/api/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userName: name,
        userCompany: company,
        userEmail: email || undefined,
        provider: t,
      }),
    });
    const r = await fetch("/api/connection");
    const j = await r.json();
    setProvider(j.provider);

    // Pre-fill placeholders for non-secret fields (e.g. host).
    const init: Record<string, string> = {};
    for (const f of j.provider.credentialFields as CredentialField[]) {
      if (f.placeholder && !f.secret && !f.required) {
        init[f.key] = f.placeholder;
      }
    }
    setCredValues(init);
  }

  function go(delta: number) {
    const next = Math.max(0, Math.min(STEPS.length - 1, stepIdx + delta));
    if (next === stepIdx) return;
    setDirection(delta > 0 ? 1 : -1);
    setStepIdx(next);
    setMaxStep((m) => Math.max(m, next));
    setError(null);
  }

  function jumpTo(target: number) {
    if (target === stepIdx) return;
    if (target > maxStep) return; // can't skip ahead past unfinished work
    setDirection(target > stepIdx ? 1 : -1);
    setStepIdx(target);
    setError(null);
  }

  // ---- step submission handlers ----

  async function submitAuth(method: "email" | "google") {
    setError(null);
    if (authMode === "signin") {
      router.push("/login");
      return;
    }
    if (!name.trim() || !company.trim()) {
      setError("Name and company are required");
      return;
    }
    if (method === "email" && !email.trim()) {
      setError("Email is required for the magic link");
      return;
    }

    setBusy(true);
    // Persist name/company/role/orgSize so they survive the auth round-trip.
    const partnerVerified = readCookie("partner_verified") === "1";
    const partnerCode = readCookie("partner_code") ?? undefined;
    const persist = await fetch("/api/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userName: name.trim(),
        userCompany: company.trim(),
        userEmail: email.trim() || undefined,
        userRole: role || undefined,
        orgSize: orgSize || undefined,
        provider: tool,
      }),
    });
    if (partnerVerified) {
      // Mark them as a partner via PATCH (POST doesn't accept these fields).
      await fetch("/api/connection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isPartner: true,
          partnerCodeUsed: partnerCode,
        }),
      });
    }
    if (!persist.ok) {
      const j = await persist.json();
      setBusy(false);
      setError(j.error ?? "Failed");
      return;
    }

    const supabase = createSupabaseBrowserClient();

    // If they're already authed (e.g. signed in via /login first), don't
    // re-trigger OAuth — just advance past the auth step.
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      setBusy(false);
      go(1);
      return;
    }

    if (method === "google") {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/signup`,
        },
      });
      setBusy(false);
      if (error) setError(error.message);
      return; // browser is redirected
    }

    const { error: emailError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/signup`,
      },
    });
    setBusy(false);
    if (emailError) {
      setError(emailError.message);
      return;
    }
    setEmailSent(true);
  }

  async function submitTool(method?: string) {
    setError(null);
    if (!provider) {
      // First time on this step; load provider config and reveal fields.
      await loadProviderForTool(tool);
      return;
    }
    // If the user clicked the SSO button, treat it like submission with empty
    // creds for now — mock OAuth — and skip credential validation. They can
    // fill in real creds later from the dashboard.
    if (method === "sso") {
      celebrate();
      go(1);
      return;
    }
    // Otherwise validate credentials via PUT
    setBusy(true);
    const r = await fetch("/api/connection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: tool, credentials: credValues }),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) {
      setError(j.error ?? "Failed");
      return;
    }
    celebrate();
    go(1);
  }

  async function submitPreferences() {
    setError(null);
    if (!prefLive && !prefFollowup) {
      setError("Please enable at least one mode");
      return;
    }
    setBusy(true);
    const r = await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefLive, prefFollowup }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json();
      setError(j.error ?? "Failed");
      return;
    }
    go(1);
  }

  async function submitCalendar(skip = false) {
    setError(null);
    setBusy(true);
    await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calendarConnected: !skip && calendarConnected,
        calendarProvider: !skip && calendarConnected ? calendarProvider : null,
      }),
    });
    setBusy(false);
    if (!skip && calendarConnected) celebrate();
    go(1);
  }

  async function submitSlack(skip = false) {
    setError(null);
    setBusy(true);
    await fetch("/api/connection", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slackConnected: !skip && slackConnected,
        slackTeamName: !skip && slackConnected ? "Demo workspace" : null,
      }),
    });
    setBusy(false);
    if (!skip && slackConnected) {
      celebrate();
      // Brief pause so the user sees the confetti before we navigate.
      await new Promise((r) => setTimeout(r, 700));
    }
    router.push("/dashboard");
  }

  // ----------- UI -----------

  if (bootstrapping) {
    return (
      <AppShell>
        <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 py-10 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-stone-200 border-t-orange-500" />
          <p className="mt-5 text-sm text-stone-600 dark:text-stone-400">
            Finishing setup…
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* Step indicator */}
        <ProgressDots stepIdx={stepIdx} maxStep={maxStep} onJump={jumpTo} />

        <div className="mt-10 grid gap-12 md:grid-cols-2">
          {/* LEFT: action */}
          <div className="min-h-[420px]">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={step}
                custom={direction}
                initial={{ opacity: 0, x: direction * 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -24 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                {step === "auth" && (
                  <AuthStep
                    authMode={authMode}
                    setAuthMode={setAuthMode}
                    name={name}
                    setName={setName}
                    company={company}
                    setCompany={setCompany}
                    email={email}
                    setEmail={setEmail}
                    role={role}
                    setRole={setRole}
                    orgSize={orgSize}
                    setOrgSize={setOrgSize}
                    tool={tool}
                    onContinue={submitAuth}
                    error={error}
                    busy={busy}
                    emailSent={emailSent}
                  />
                )}
                {step === "tool" && (
                  <ToolStep
                    tool={tool}
                    setTool={(t) => {
                      setTool(t);
                      // Eagerly fetch provider shape so fields appear.
                      loadProviderForTool(t);
                    }}
                    provider={provider}
                    credValues={credValues}
                    setCredValues={setCredValues}
                    onContinue={() => submitTool()}
                    onSso={() => submitTool("sso")}
                    error={error}
                    busy={busy}
                  />
                )}
                {step === "preferences" && (
                  <PreferencesStep
                    toolName={provider?.name ?? "PostHog"}
                    prefLive={prefLive}
                    setPrefLive={setPrefLive}
                    prefFollowup={prefFollowup}
                    setPrefFollowup={setPrefFollowup}
                    onContinue={submitPreferences}
                    error={error}
                    busy={busy}
                  />
                )}
                {step === "calendar" && (
                  <CalendarStep
                    connected={calendarConnected}
                    provider={calendarProvider}
                    onConnect={(p) => {
                      setCalendarProvider(p);
                      setCalendarConnected(true);
                    }}
                    onContinue={() => submitCalendar(false)}
                    onSkip={() => submitCalendar(true)}
                    busy={busy}
                  />
                )}
                {step === "slack" && (
                  <SlackStep
                    connected={slackConnected}
                    onConnect={() => setSlackConnected(true)}
                    onContinue={() => submitSlack(false)}
                    onSkip={() => submitSlack(true)}
                    busy={busy}
                  />
                )}
              </motion.div>
            </AnimatePresence>

            {/* Back button */}
            {stepIdx > 0 && (
              <button
                type="button"
                onClick={() => go(-1)}
                className="mt-8 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-200"
              >
                ← back
              </button>
            )}
          </div>

          {/* RIGHT: marketing */}
          <div className="hidden md:block">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="sticky top-10 rounded-2xl border border-stone-200 bg-gradient-to-b from-amber-50/40 to-stone-50 p-8 dark:border-stone-800 dark:from-amber-900/10 dark:to-stone-900/40"
              >
                <Marketing step={step} toolName={provider?.name ?? "PostHog"} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function ProgressDots({
  stepIdx,
  maxStep,
  onJump,
}: {
  stepIdx: number;
  maxStep: number;
  onJump: (i: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {STEPS.map((s, i) => {
        const reachable = i <= maxStep;
        const active = i === stepIdx;
        return (
          <div key={s.id} className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onJump(i)}
              disabled={!reachable}
              className={`flex items-center gap-2 rounded-full px-2 py-1 transition ${
                reachable
                  ? "cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800"
                  : "cursor-not-allowed"
              }`}
              aria-current={active ? "step" : undefined}
            >
              <motion.span
                animate={{
                  scale: active ? 1.2 : 1,
                  backgroundColor: i <= stepIdx
                    ? "rgb(28 25 23)"
                    : "rgb(214 211 209)",
                }}
                transition={{ duration: 0.2 }}
                className="inline-block h-2 w-2 rounded-full"
              />
              <span
                className={`text-xs uppercase tracking-widest transition ${
                  active
                    ? "text-stone-900 dark:text-stone-100"
                    : reachable
                      ? "text-stone-600 dark:text-stone-400"
                      : "text-stone-400"
                }`}
              >
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <div className="h-px w-6 bg-stone-200 dark:bg-stone-800" />
            )}
          </div>
        );
      })}
    </div>
  );
}

const ROLE_OPTIONS = [
  "Product Manager",
  "Founder / CEO",
  "Engineer",
  "Designer",
  "Data / Analyst",
  "Marketing",
  "Customer Success",
  "Operations",
  "Other",
];

const ORG_SIZE_OPTIONS = [
  "1-10",
  "11-50",
  "51-200",
  "201-1000",
  "1000+",
];

function AuthStep(props: {
  name: string;
  setName: (v: string) => void;
  company: string;
  setCompany: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  role: string;
  setRole: (v: string) => void;
  orgSize: string;
  setOrgSize: (v: string) => void;
  onContinue: (method: "email" | "google") => void;
  error: string | null;
  busy: boolean;
  emailSent: boolean;
  // unused but accepted for back-compat during refactor
  authMode?: unknown;
  setAuthMode?: unknown;
  tool?: unknown;
}) {
  if (props.emailSent) {
    return (
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Check your inbox</h2>
        <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
          We sent a magic link to <strong>{props.email}</strong>. Click it and you&apos;ll come back here to finish setting up.
        </p>
        <div className="mt-6 rounded-md bg-stone-100 px-4 py-3 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-400">
          You can close this tab — clicking the email link will reopen the wizard.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Create your account</h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        Already have an account?{" "}
        <a href="/login" className="font-medium text-stone-900 underline dark:text-stone-100">
          Sign in
        </a>
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.onContinue("email");
        }}
        className="mt-8 space-y-4"
      >
        <Field label="Name">
          <Input
            required
            value={props.name}
            onChange={(e) => props.setName(e.target.value)}
            placeholder="Alex Rivera"
          />
        </Field>
        <Field label="Company">
          <Input
            required
            value={props.company}
            onChange={(e) => props.setCompany(e.target.value)}
            placeholder="Acme"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your role">
            <Select
              value={props.role}
              onChange={(v) => props.setRole(v)}
              placeholder="Select…"
              options={ROLE_OPTIONS}
            />
          </Field>
          <Field label="Org size">
            <Select
              value={props.orgSize}
              onChange={(v) => props.setOrgSize(v)}
              placeholder="Select…"
              options={ORG_SIZE_OPTIONS}
            />
          </Field>
        </div>

        <div className="my-5 flex items-center gap-3">
          <hr className="grow border-stone-200 dark:border-stone-800" />
          <span className="text-xs uppercase tracking-widest text-stone-400">then sign in with</span>
          <hr className="grow border-stone-200 dark:border-stone-800" />
        </div>

        <SecondaryButton type="button" onClick={() => props.onContinue("google")} disabled={props.busy}>
          <img src="https://www.google.com/favicon.ico" alt="" className="h-4 w-4" />
          Continue with Google
        </SecondaryButton>

        <div className="my-3 flex items-center gap-3">
          <hr className="grow border-stone-200 dark:border-stone-800" />
          <span className="text-xs uppercase tracking-widest text-stone-400">or work email</span>
          <hr className="grow border-stone-200 dark:border-stone-800" />
        </div>

        <Field label="Work email">
          <Input
            type="email"
            value={props.email}
            onChange={(e) => props.setEmail(e.target.value)}
            placeholder="alex@acme.com"
          />
        </Field>

        {props.error && <ErrorBox>{props.error}</ErrorBox>}

        <PrimaryButton type="submit" disabled={props.busy}>
          {props.busy ? "Sending…" : "Send magic link"}
        </PrimaryButton>
      </form>
    </div>
  );
}

function ToolStep(props: {
  tool: ToolId;
  setTool: (t: ToolId) => void;
  provider: ProviderShape | null;
  credValues: Record<string, string>;
  setCredValues: (fn: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  onContinue: () => void;
  onSso: () => void;
  error: string | null;
  busy: boolean;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">
        Pick your data tool
      </h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        We&apos;ll connect through their MCP. Your data stays where it is.
      </p>

      <div className="mt-6 space-y-3">
        {TOOLS.map((t) => {
          const disabled = !t.available;
          const selected = props.tool === t.id;
          return (
            <button
              key={t.id}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && props.setTool(t.id)}
              className={`group flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition ${
                disabled
                  ? "cursor-not-allowed border-stone-200 bg-stone-50 opacity-70 dark:border-stone-800 dark:bg-stone-900/40"
                  : selected
                  ? "border-stone-900 bg-stone-100 dark:border-stone-100 dark:bg-stone-800"
                  : "border-stone-200 hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700"
              }`}
            >
              <span className="flex items-center gap-2.5">
                {t.iconSrc ? (
                  <img src={t.iconSrc} alt="" className="h-5 w-5 rounded-sm object-contain" />
                ) : (
                  <span className="inline-block h-5 w-5 rounded-sm bg-stone-200 dark:bg-stone-700" />
                )}
                <span className="text-sm font-medium">{t.name}</span>
                {t.recommended && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                    Recommended
                  </span>
                )}
                {disabled && (
                  <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                    Coming soon
                  </span>
                )}
              </span>
              <span className="text-stone-400">
                {selected && !disabled ? "✓" : ""}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {props.provider && (
          <motion.div
            key={props.provider.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="mt-6 overflow-hidden"
          >
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-5 dark:border-stone-800 dark:bg-stone-900">
              <div className="mb-3 text-xs uppercase tracking-widest text-stone-500">
                Connect {props.provider.name}
              </div>

              {/* Primary action: OAuth (~5x faster). Sits at the top before
                  any field inputs so it's visually unmissable. */}
              {props.provider.id === "posthog" && (
                <div className="mb-5">
                  <PosthogConnectButton
                    comingSoon={false}
                    badge="~5× faster"
                    href={`/api/oauth/posthog/start?return=/signup&region=${getRegionFromHost(props.credValues.host)}`}
                  />
                  <p className="mt-2 text-center text-[11px] text-stone-500">
                    One click — works with SSO/SAML. No keys to copy.
                  </p>
                </div>
              )}

              {props.provider.id === "posthog" && (
                <div className="my-5 flex items-center gap-3">
                  <hr className="grow border-stone-200 dark:border-stone-800" />
                  <span className="text-[10px] uppercase tracking-widest text-stone-500">
                    Or the longer way
                  </span>
                  <hr className="grow border-stone-200 dark:border-stone-800" />
                </div>
              )}

              <div className="space-y-3">
                {props.provider.credentialFields.map((f) => (
                  <Field key={f.key} label={f.label}>
                    {f.regions ? (
                      <RegionField
                        field={f}
                        value={props.credValues[f.key] ?? f.placeholder ?? ""}
                        onChange={(v) =>
                          props.setCredValues((prev: Record<string, string>) => ({
                            ...prev,
                            [f.key]: v,
                          }))
                        }
                      />
                    ) : (
                      <Input
                        type={f.secret ? "password" : "text"}
                        placeholder={f.placeholder}
                        value={props.credValues[f.key] ?? ""}
                        onChange={(e) =>
                          props.setCredValues((prev: Record<string, string>) => ({
                            ...prev,
                            [f.key]: e.target.value,
                          }))
                        }
                      />
                    )}
                    {f.helpText && (
                      <p
                        className="mt-1 text-xs text-stone-500"
                        dangerouslySetInnerHTML={{ __html: f.helpText }}
                      />
                    )}
                  </Field>
                ))}
              </div>

              {props.error && <ErrorBox>{props.error}</ErrorBox>}

              <PrimaryButton
                type="button"
                disabled={props.busy}
                onClick={props.onContinue}
                className="mt-4"
              >
                {props.busy ? "Validating…" : "Use API key & continue"}
              </PrimaryButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PreferencesStep(props: {
  toolName: string;
  prefLive: boolean;
  setPrefLive: (v: boolean) => void;
  prefFollowup: boolean;
  setPrefFollowup: (v: boolean) => void;
  onContinue: () => void;
  error: string | null;
  busy: boolean;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">How should I work?</h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        Pick at least one. Smart follows is recommended.
      </p>
      <div className="mt-6 space-y-4">
        <SmartFollowsBigCard
          checked={props.prefFollowup}
          onChange={() => props.setPrefFollowup(!props.prefFollowup)}
          providerName={props.toolName}
        />
        <BasicPrefRow
          checked={props.prefLive}
          onChange={() => props.setPrefLive(!props.prefLive)}
          title={`"Hey ${props.toolName}" — answer live in calls`}
          subtitle="Reply in chat in 5–10s when someone uses the wake word."
          badge="Available, but not great yet"
        />
      </div>

      {props.error && <ErrorBox>{props.error}</ErrorBox>}

      <PrimaryButton
        type="button"
        onClick={props.onContinue}
        disabled={props.busy}
        className="mt-6"
      >
        {props.busy ? "Saving…" : "Continue"}
      </PrimaryButton>
    </div>
  );
}

function SmartFollowsBigCard({
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

function BasicPrefRow({
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

function CalendarStep(props: {
  connected: boolean;
  provider: "google" | "microsoft" | null;
  onConnect: (p: "google" | "microsoft") => void;
  onContinue: () => void;
  onSkip: () => void;
  busy: boolean;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Connect your calendar</h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        So DataDonkey auto-joins meetings on your calendar with a video link.
      </p>

      <div className="mt-6 space-y-3">
        {props.connected && props.provider === "google" ? (
          <div className="flex w-full items-center justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-100">
            <span className="flex items-center gap-2.5">
              <img src="/googlecal.png" alt="" className="h-5 w-5 object-contain" />
              Google Calendar connected
            </span>
            <span>✓</span>
          </div>
        ) : (
          <a
            href="/api/oauth/google/start?return=/signup"
            className="flex w-full items-center justify-between gap-2 rounded-md border border-stone-300 bg-white px-4 py-3 text-sm font-medium text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
          >
            <span className="flex items-center gap-2.5">
              <img src="/googlecal.png" alt="" className="h-5 w-5 object-contain" />
              Connect Google Calendar
            </span>
            <span>→</span>
          </a>
        )}
      </div>

      <p className="mt-4 text-xs text-stone-500">
        We only read events with a meeting link. We never read your inbox.
      </p>

      <div className="mt-6 flex gap-3">
        <PrimaryButton onClick={props.onContinue} disabled={props.busy}>
          {props.connected ? "Continue" : "Continue without calendar"}
        </PrimaryButton>
        {!props.connected && (
          <button
            type="button"
            onClick={props.onSkip}
            className="text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-200"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

function SlackStep(props: {
  connected: boolean;
  onConnect: () => void;
  onContinue: () => void;
  onSkip: () => void;
  busy: boolean;
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Connect Slack</h2>
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
        Optional. We&apos;ll DM you the post-call follow-up so you can share it.
      </p>

      <div className="mt-6">
        {props.connected ? (
          <div className="flex w-full items-center justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-100">
            <span className="flex items-center gap-2.5">
              <img src="/slackicon.png" alt="" className="h-5 w-5 object-contain" />
              Slack connected
            </span>
            <span>✓</span>
          </div>
        ) : (
          <a
            href="/api/oauth/slack/start?return=/signup"
            className="flex w-full items-center justify-between gap-2 rounded-md border border-stone-300 bg-white px-4 py-3 text-sm font-medium text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
          >
            <span className="flex items-center gap-2.5">
              <img src="/slackicon.png" alt="" className="h-5 w-5 object-contain" />
              Connect Slack
            </span>
            <span>→</span>
          </a>
        )}
      </div>

      <div className="mt-6 flex gap-3">
        <PrimaryButton onClick={props.onContinue} disabled={props.busy}>
          {props.connected ? "Finish & open dashboard" : "Finish without Slack"}
        </PrimaryButton>
        {!props.connected && (
          <button
            type="button"
            onClick={props.onSkip}
            className="text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-200"
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

function Marketing({ step, toolName }: { step: StepId; toolName: string }) {
  if (step === "auth") {
    return (
      <Copy
        kicker="Welcome"
        title="Your data analyst on every call."
        body={[
          "Stop alt-tabbing to look up numbers mid-meeting. Stop forgetting follow-ups.",
          `Say "Hey ${toolName}" in a call and the answer lands in chat in seconds. After the call, you get an email with the data points you missed.`,
        ]}
      />
    );
  }
  if (step === "tool") {
    return (
      <Copy
        kicker="Why we ask"
        title="Bring your own analytics."
        body={[
          "Your data lives in PostHog, Mixpanel, or Amplitude. We pass questions through their MCP servers — your data never copies into us.",
          "Need a Personal API key? PostHog → Settings → Personal API keys. Read scopes for query, insight, dashboard, feature flags, experiments are enough.",
        ]}
      />
    );
  }
  if (step === "preferences") {
    return (
      <Copy
        kicker="Two superpowers"
        title="Live answers + smart follow-ups."
        body={[
          "Live answers handle the moment-of-truth in calls. Smart follow-ups handle everything you forgot to ask.",
          "Most teams keep both on. Pick one if you only want the bot in some places.",
        ]}
      />
    );
  }
  if (step === "calendar") {
    return (
      <Copy
        kicker="Auto-join"
        title="Joins itself, when you want it."
        body={[
          "DataDonkey reads your calendar to know when to join. We only see events with a meeting link.",
          "You can always paste a meeting URL manually from the dashboard.",
        ]}
      />
    );
  }
  return (
    <Copy
      kicker="Optional"
      title="Slack is where most teams want this."
      body={[
        "Post-call follow-ups go to a Slack DM, ready for you to forward to the team.",
        "Skip this for now — you can connect later.",
      ]}
    />
  );
}

function Copy({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: string;
  body: string[];
}) {
  return (
    <div className="space-y-4">
      <div className="text-xs uppercase tracking-widest text-amber-700 dark:text-amber-300">
        {kicker}
      </div>
      <h3 className="text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
        {title}
      </h3>
      {body.map((p, i) => (
        <p key={i} className="text-sm leading-relaxed text-stone-700 dark:text-stone-300">
          {p}
        </p>
      ))}
    </div>
  );
}

// ---- shared UI primitives ----

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-stone-700 dark:text-stone-300">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function RegionField({
  field,
  value,
  onChange,
}: {
  field: CredentialField;
  value: string;
  onChange: (v: string) => void;
}) {
  const regions = field.regions ?? [];
  const matched = regions.find((r) => r.url === value);
  const initial = matched?.id ?? (value && value !== field.placeholder ? "custom" : regions[0]?.id ?? "us");
  const [selected, setSelected] = useState<string>(initial);
  const isCustom = selected === "custom";

  function pick(id: string) {
    setSelected(id);
    const r = regions.find((rr) => rr.id === id);
    if (r && r.id !== "custom") onChange(r.url);
    else if (r && r.id === "custom") onChange("");
  }

  return (
    <div className="space-y-2">
      <select
        value={selected}
        onChange={(e) => pick(e.target.value)}
        className="block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-500 focus:outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
      >
        {regions.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
      {isCustom && (
        <Input
          type="text"
          placeholder="https://your-posthog.example.com"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-stone-500 focus:outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
    >
      <option value="">{placeholder ?? "Select…"}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-500 focus:outline-none dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 ${
        props.className ?? ""
      }`}
    />
  );
}

function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`w-full rounded-md bg-stone-900 px-4 py-2.5 text-sm font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200 ${
        props.className ?? ""
      }`}
    />
  );
}

function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`flex w-full items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-900 hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800 ${
        props.className ?? ""
      }`}
    />
  );
}

function ConnectButton({
  connected,
  onClick,
  children,
  iconSrc,
}: {
  connected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  iconSrc?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-md border px-4 py-3 text-sm font-medium transition ${
        connected
          ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-100"
          : "border-stone-300 bg-white text-stone-900 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800"
      }`}
    >
      <span className="flex items-center gap-2.5">
        {iconSrc && <img src={iconSrc} alt="" className="h-5 w-5 object-contain" />}
        <span>{children}</span>
      </span>
      <span>{connected ? "✓ connected" : "→"}</span>
    </button>
  );
}

function Toggle({
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
          className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm`}
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

function getRegionFromHost(host: string | undefined): "us" | "eu" {
  if (!host) return "us";
  if (host.includes("eu.posthog.com")) return "eu";
  return "us";
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v ?? "");
  }
  return null;
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
      {children}
    </div>
  );
}
