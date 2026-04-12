import { useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import type { CurrentUser } from "../lib/api";

type AppShellProps = {
  user: CurrentUser;
  onLogout: () => Promise<void>;
  children: ReactNode;
};

const legacyLinks = [
  { href: "/upload", label: "Загрузить", requireWorker: true },
  { href: "/predict", label: "Magic" },
  { href: "/stats", label: "Info" },
  { href: "/admin", label: "Админ", requireAdmin: true },
];

export function AppShell({ user, onLogout, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const visibleLinks = legacyLinks.filter((link) => {
    if (link.requireAdmin && !user.permissions.is_admin) {
      return false;
    }

    if (link.requireWorker && !user.permissions.at_least_worker) {
      return false;
    }

    return true;
  });

  function navLinkClass(href: string) {
    const isActive = href === "/"
      ? location.pathname === href
      : location.pathname === href || location.pathname.startsWith(`${href}/`);

    if (isActive) {
      return "rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800";
    }

    return "rounded-full px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-ink";
  }

  function mobileNavLinkClass(href: string) {
    const isActive = href === "/"
      ? location.pathname === href
      : location.pathname === href || location.pathname.startsWith(`${href}/`);

    if (isActive) {
      return "rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white";
    }

    return "rounded-xl px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-ink";
  }

  return (
    <div className="min-h-screen bg-surface text-ink">
      <div className="absolute inset-0 -z-10 bg-grid bg-[size:34px_34px] opacity-70" />
      <div className="absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(circle_at_top_right,_rgba(15,124,255,0.18),_transparent_32%),radial-gradient(circle_at_top_left,_rgba(117,213,255,0.25),_transparent_28%)]" />

      <div className="mx-auto max-w-7xl px-4 pb-8 pt-6 sm:px-6 lg:px-8">
        <header className="panel sticky top-4 z-20 mb-8 border border-white/70 px-4 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <a href="/" className="group flex items-center">
                <p className="text-2xl font-black uppercase tracking-[0.22em] text-ink transition duration-200 group-hover:scale-[1.03]">
                  WRINKLES
                </p>
              </a>
            </div>

            <nav className="hidden items-center gap-2 lg:flex">
              <a href="/" className={navLinkClass("/")}>Каталог</a>
              {visibleLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className={navLinkClass(link.href)}
                >
                  {link.label}
                </a>
              ))}
            </nav>

            <div className="hidden items-center gap-3 lg:flex">
              <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-2 text-right">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                  {user.role}
                </p>
                <p className="text-sm font-semibold text-ink">{user.username}</p>
              </div>
              <div className="relative">
                <button
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-slate-300 hover:bg-slate-50"
                  onClick={() => setMenuOpen((value) => !value)}
                >
                  Аккаунт
                </button>
                {menuOpen ? (
                  <div className="absolute right-0 z-30 mt-3 w-56 rounded-2xl border border-slate-200 bg-white p-3 shadow-panel">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Профиль</p>
                    <p className="mt-2 text-sm font-semibold text-ink">{user.username}</p>
                    <p className="mt-1 text-sm text-slate-500">{user.role}</p>
                    <button
                      className="mt-4 w-full rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                      onClick={() => {
                        setMenuOpen(false);
                        void onLogout();
                      }}
                    >
                      Выйти
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <button
              className="inline-flex rounded-2xl border border-slate-200 bg-white p-3 text-slate-700 transition hover:bg-slate-50 lg:hidden"
              onClick={() => setMobileOpen((value) => !value)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
          </div>

          {mobileOpen ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 lg:hidden">
              <div className="flex flex-col gap-2">
                <a href="/" className={mobileNavLinkClass("/")}>Каталог</a>
                {visibleLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className={mobileNavLinkClass(link.href)}
                  >
                    {link.label}
                  </a>
                ))}
              </div>
              <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{user.role}</p>
                <p className="mt-1 text-sm font-semibold text-ink">{user.username}</p>
                <button
                  className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-ink"
                  onClick={() => void onLogout()}
                >
                  Выйти
                </button>
              </div>
            </div>
          ) : null}
        </header>

        {children}
      </div>
    </div>
  );
}
