"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";

interface AppShellProps {
  children: React.ReactNode;
  // The header has different affordances on marketing vs app pages.
  showAppNav?: boolean;
  user?: { name: string | null; company: string | null; email: string | null } | null;
}

export function AppShell({ children, showAppNav, user }: AppShellProps) {
  return (
    <div className="min-h-dvh">
      <Header showAppNav={showAppNav} user={user ?? null} />
      <main>{children}</main>
    </div>
  );
}

function Header({
  showAppNav,
  user,
}: {
  showAppNav?: boolean;
  user: { name: string | null; company: string | null; email: string | null } | null;
}) {
  return (
    <header className="border-b border-stone-200/60 bg-stone-50/80 backdrop-blur-sm dark:border-stone-800/60 dark:bg-stone-950/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href={showAppNav ? "/dashboard" : "/"} className="flex items-center gap-2">
          <span className="text-xl">🫏</span>
          <span className="text-base font-semibold tracking-tight">datadonkey</span>
        </Link>

        <div className="flex items-center gap-2">
          {!showAppNav && (
            <>
              <Link
                href="/login"
                className="rounded-md px-3 py-1.5 text-sm text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-stone-900 px-3 py-1.5 text-sm font-medium text-stone-50 hover:bg-stone-800 dark:bg-stone-50 dark:text-stone-900 dark:hover:bg-stone-200"
              >
                Get started
              </Link>
            </>
          )}
          <ThemeToggle />
          {showAppNav && user && <ProfileMenu user={user} />}
        </div>
      </div>
    </header>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={toggle}
      className="rounded-md p-2 text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function ProfileMenu({
  user,
}: {
  user: { name: string | null; company: string | null; email: string | null };
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const initials =
    (user.name ?? "U")
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-900 text-xs font-medium text-stone-50 ring-1 ring-stone-200 hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:ring-stone-800 dark:hover:bg-stone-200"
        aria-label="Profile menu"
      >
        {initials}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-64 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg dark:border-stone-800 dark:bg-stone-900">
          <div className="border-b border-stone-100 p-4 dark:border-stone-800">
            <div className="text-sm font-medium text-stone-900 dark:text-stone-100">
              {user.name ?? "—"}
            </div>
            {user.company && (
              <div className="text-xs text-stone-500">{user.company}</div>
            )}
            {user.email && (
              <div className="mt-1 truncate text-xs text-stone-500">{user.email}</div>
            )}
          </div>
          <a
            href="/"
            className="block px-4 py-2 text-sm text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800"
          >
            Sign out
          </a>
        </div>
      )}
    </div>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
