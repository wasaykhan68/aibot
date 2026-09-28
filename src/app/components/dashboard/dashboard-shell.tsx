"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import {
  api,
  AuthUser,
  clearSession,
  getStoredUser,
  getToken,
  saveSession,
} from "@/app/lib/api";
import OnboardingModal from "@/app/components/onboarding/onboarding-modal";

type NavId = "analytics" | "chatbot" | "products" | "leads" | "settings";

type DashboardContextValue = {
  user: AuthUser;
  persistUser: (next: AuthUser) => void;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard() {
  const value = useContext(DashboardContext);
  if (!value) {
    throw new Error("useDashboard must be used inside DashboardShell");
  }
  return value;
}

const nav: { id: NavId; href: string; label: string }[] = [
  { id: "analytics", href: "/dashboard/analytics", label: "Analytics" },
  { id: "chatbot", href: "/dashboard/chatbot", label: "Chatbot" },
  { id: "products", href: "/dashboard/products", label: "Products" },
  { id: "leads", href: "/dashboard/leads", label: "Leads" },
  { id: "settings", href: "/dashboard/settings", label: "Chatbot settings" },
];

export default function DashboardShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }

    const stored = getStoredUser();
    if (stored) {
      setUser(stored);
    }

    async function load() {
      try {
        const me = await api<AuthUser>("/api/me");
        saveSession(getToken() as string, me);
        setUser(me);
        if (me.needsOnboarding && !sessionStorage.getItem("aibot_onboarding_dismissed")) {
          setShowOnboarding(true);
        }
      } catch {
        clearSession();
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [router]);

  function persistUser(next: AuthUser) {
    const token = getToken();
    if (token) saveSession(token, next);
    setUser(next);
  }

  function logout() {
    clearSession();
    router.replace("/login");
  }

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f6f4ef] text-slate-500">
        Loading dashboard...
      </main>
    );
  }

  return (
    <DashboardContext.Provider value={{ user, persistUser }}>
      <main className="h-screen overflow-hidden bg-[#f6f4ef] text-slate-900">
        <div className="flex h-full">
          <aside className="flex h-full w-64 shrink-0 flex-col border-r border-stone-200 bg-[#163532] px-5 py-6 text-[#f6f4ef]">
            <p className="text-sm font-semibold tracking-[0.2em] uppercase">Aibot</p>
            <p className="mt-2 text-sm text-[#9db5af]">{user.companyName}</p>

            <nav className="mt-10 space-y-2">
              {nav.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                      active ? "bg-white/15" : "hover:bg-white/10"
                    }`}
                  >
                    <NavIcon id={item.id} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <button
              type="button"
              onClick={logout}
              className="mt-auto rounded-lg px-3 py-2.5 text-left text-sm text-[#9db5af] hover:bg-white/10 hover:text-white"
            >
              Log out
            </button>
          </aside>

          <section className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-8 md:px-10">
            {children}
          </section>
        </div>

        {showOnboarding ? (
          <OnboardingModal
            onComplete={(next) => {
              persistUser(next);
              sessionStorage.removeItem("aibot_onboarding_dismissed");
              setShowOnboarding(false);
              router.push("/dashboard/settings");
            }}
            onSkip={() => {
              sessionStorage.setItem("aibot_onboarding_dismissed", "1");
              setShowOnboarding(false);
            }}
          />
        ) : null}
      </main>
    </DashboardContext.Provider>
  );
}

function NavIcon({ id }: { id: NavId }) {
  const className = "h-4 w-4 shrink-0 opacity-80";
  if (id === "analytics") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
      </svg>
    );
  }
  if (id === "chatbot") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 6h14v10H8l-3 3V6z" />
      </svg>
    );
  }
  if (id === "products") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 8h16l-1.5 12h-13L4 8zM8 8V6a4 4 0 0 1 8 0v2" />
      </svg>
    );
  }
  if (id === "leads") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zM4 20a8 8 0 0 1 16 0" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4v2M12 18v2M4 12h2M18 12h2" />
    </svg>
  );
}
