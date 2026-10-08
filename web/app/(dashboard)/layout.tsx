"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { canAccessPage, visibleNav } from "@/lib/roles";

const NAV = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/visits", label: "Visits & Audits", icon: "📋" },
  { href: "/branches", label: "Branches", icon: "🏢" },
  { href: "/employees", label: "Employees & IT", icon: "👥" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

const STORAGE_KEY = "bv_rail_collapsed";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!loading && user && pathname && !canAccessPage(user, pathname)) {
      router.replace("/");
    }
  }, [loading, user, pathname, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "1") setCollapsed(true);
  }, []);

  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768) setMobileOpen(false);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gh-canvas">
        <div className="animate-spin h-8 w-8 border-4 border-[#2f81f7] border-t-transparent rounded-full" />
      </div>
    );
  }

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };

  const railWidth = collapsed ? "w-[4.25rem]" : "w-[16rem]";

  return (
    <div className="min-h-screen flex bg-gh-canvas text-gh-text font-sans">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col gh-strip transition-all duration-200 ${
          isMobile
            ? `${mobileOpen ? "translate-x-0" : "-translate-x-full"} w-[16rem]`
            : railWidth
        }`}
        aria-label="Sidebar"
      >
        {/* Header / Brand */}
        <div
          className={`flex items-center border-b border-white/[0.07] ${
            collapsed ? "justify-center" : "justify-between"
          } px-4 h-16 flex-shrink-0`}
        >
          {!collapsed && (
            <div className="overflow-hidden">
              <h1 className="text-sm font-bold text-[#e6edf3] leading-tight whitespace-nowrap flex items-center gap-1.5">
                <span className="text-base">🛡️</span>
                <span>Branch Visit CMS</span>
              </h1>
              <p className="text-[0.65rem] text-[#7d8590] whitespace-nowrap">Audit & Compliance Management</p>
            </div>
          )}
          {collapsed && (
            <span className="text-lg font-bold text-[#2f81f7]" title="Branch Visit CMS">
              🛡️
            </span>
          )}
          <button
            onClick={toggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#7d8590] hover:text-[#e6edf3] hover:bg-white/[0.06] transition-colors"
          >
            <span className={`text-sm transition-transform duration-200 ${collapsed ? "" : "rotate-180"}`}>
              «
            </span>
          </button>
          {isMobile && (
            <button
              onClick={() => setMobileOpen(false)}
              aria-label="Close sidebar"
              className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#7d8590] hover:text-[#e6edf3] hover:bg-white/[0.06]"
            >
              ✕
            </button>
          )}
        </div>

        {/* Navigation items */}
        <nav className={`flex-1 ${collapsed ? "px-2.5 py-3" : "px-3 py-4"} space-y-1 gh-scroll overflow-y-auto`}>
          {visibleNav(NAV, user).map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => isMobile && setMobileOpen(false)}
                title={collapsed ? item.label : undefined}
                className={`group relative flex items-center gap-3 rounded-xl text-sm font-semibold transition-all ${
                  collapsed ? "justify-center h-11 px-0" : "px-3.5 py-2.5"
                } ${
                  active
                    ? "bg-[#2f81f7]/15 text-[#58a6ff] shadow-sm"
                    : "text-[#9198a1] hover:text-[#e6edf3] hover:bg-white/[0.04]"
                }`}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-[#2f81f7]" />
                )}
                <span className="text-lg leading-none w-6 text-center">{item.icon}</span>
                {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User Card */}
        <div
          className={`border-t border-white/[0.07] p-3 flex-shrink-0 ${
            collapsed ? "flex flex-col items-center gap-2" : ""
          }`}
        >
          <div className={`flex items-center gap-2.5 overflow-hidden ${collapsed ? "flex-col" : ""}`}>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2f81f7]/20 text-xs font-bold text-[#58a6ff]">
              {(user.first_name ?? user.email ?? "?").charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="min-w-0 overflow-hidden">
                <p className="truncate text-xs font-semibold text-[#e6edf3]">{user.full_name ?? user.email}</p>
                <p className="truncate text-[0.65rem] text-[#7d8590]">
                  {user.roles?.map((r: any) => r.name).join(", ") || "User"}
                </p>
              </div>
            )}
          </div>
          {!collapsed && (
            <button
              onClick={() => {
                logout();
                router.replace("/login");
              }}
              className="mt-2 w-full rounded-lg px-3 py-1.5 text-left text-xs text-[#7d8590] hover:text-[#f85149] hover:bg-white/[0.05] transition-colors"
            >
              Sign out →
            </button>
          )}
        </div>
      </aside>

      {/* Main Container */}
      <main
        className={`flex-1 min-w-0 transition-[padding] duration-200 ${
          isMobile ? "pl-0" : collapsed ? "md:pl-[4.25rem]" : "md:pl-[16rem]"
        }`}
      >
        <div className="gh-canvas gh-scroll p-6 md:p-8 pb-16 min-h-screen relative">
          <div className="gh-orb gh-orb--blue" aria-hidden />
          <div className="gh-orb gh-orb--violet" aria-hidden />
          <div className="gh-orb gh-orb--green" aria-hidden />
          <div className="relative z-10">{children}</div>
        </div>
      </main>
    </div>
  );
}
