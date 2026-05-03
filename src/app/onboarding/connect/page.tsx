"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  helpText?: string;
}

interface ConnectionInfo {
  signedUp: boolean;
  connected: boolean;
  userName: string | null;
  provider: {
    id: string;
    name: string;
    available: boolean;
    credentialFields: CredentialField[];
    setupHint?: string;
  };
}

export default function OnboardingConnect() {
  const router = useRouter();
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/connection")
      .then((r) => r.json())
      .then((j: ConnectionInfo) => {
        if (!j.signedUp) {
          router.replace("/signup");
          return;
        }
        setInfo(j);
        // Pre-fill non-secret defaults (e.g. host)
        const init: Record<string, string> = {};
        for (const f of j.provider.credentialFields) {
          if (f.placeholder && !f.secret) init[f.key] = f.placeholder;
        }
        setValues(init);
      });
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!info) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/connection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: info.provider.id,
        credentials: values,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json();
      setError(j.error ?? "Failed");
      return;
    }
    router.push("/dashboard");
  }

  if (!info) {
    return (
      <div className="min-h-dvh bg-stone-50 px-6 py-16 text-stone-500 dark:bg-stone-950">
        Loading…
      </div>
    );
  }

  const { provider } = info;
  const visibleFields = provider.credentialFields;

  return (
    <div className="min-h-dvh bg-stone-50 dark:bg-stone-950">
      <div className="mx-auto max-w-md px-6 py-16">
        <a href="/" className="inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-900 dark:hover:text-stone-100">
          <span>🫏</span>
          <span>datadonkey</span>
        </a>

        <p className="mt-10 text-sm uppercase tracking-widest text-stone-500">
          Step 2 of 2
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">
          Connect {provider.name}
        </h1>
        {provider.setupHint && (
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-400">
            {provider.setupHint}
          </p>
        )}

        <form onSubmit={submit} className="mt-10 space-y-5">
          {visibleFields.map((f) => (
            <label key={f.key} className="block">
              <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
                {f.label}
              </span>
              <input
                type={f.secret ? "password" : "text"}
                value={values[f.key] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [f.key]: e.target.value }))
                }
                placeholder={f.placeholder}
                className="mt-1.5 block w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
              />
              {f.helpText && (
                <span className="mt-1.5 block text-xs text-stone-500">{f.helpText}</span>
              )}
            </label>
          ))}

          {!provider.available && (
            <div className="rounded-md bg-amber-50 px-3 py-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Heads up: live Q&amp;A for {provider.name} isn&apos;t available yet
              — its MCP server hasn&apos;t shipped. We&apos;ll save your
              credentials and turn things on the moment it&apos;s available.
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-stone-900 px-4 py-2.5 text-sm font-medium text-stone-50 hover:bg-stone-800 disabled:opacity-50 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200"
          >
            {busy ? "Connecting…" : "Connect & continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
