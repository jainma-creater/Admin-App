"use client";

import React from "react";
import Link from "next/link";

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "success" | "ghost";
}) {
  const variants = {
    primary:
      "bg-[#2f81f7] hover:bg-[#1f6feb] text-white shadow-[0_0_0_1px_rgba(47,129,247,0.35),0_4px_16px_rgba(47,129,247,0.25)]",
    secondary: "bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] border border-white/[0.12]",
    danger: "bg-[#da3633] hover:bg-[#b62324] text-white",
    success: "bg-[#238636] hover:bg-[#2ea043] text-white",
    ghost: "bg-transparent hover:bg-white/[0.06] text-[#9198a1] hover:text-[#e6edf3]",
  };
  return (
    <button
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className = "",
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-gh-border bg-gh-panel shadow-glass ${onClick ? "cursor-pointer glass-hover" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold text-white border border-white/[0.07] ${className}`}>
      {children}
    </span>
  );
}

export function Input({
  className = "",
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <div>
      {label && <label className="block text-xs font-medium text-gh-muted mb-1">{label}</label>}
      <input
        className={`w-full border border-[#30363d] rounded-lg px-3 py-2 text-sm bg-gh-canvas text-gh-text placeholder:text-gh-faint focus:outline-none focus:ring-2 focus:ring-[#2f81f7] focus:border-[#2f81f7] ${className}`}
        {...props}
      />
    </div>
  );
}

export function Select({
  children,
  className = "",
  label,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <div>
      {label && <label className="block text-xs font-medium text-gh-muted mb-1">{label}</label>}
      <select
        className={`w-full border border-[#30363d] rounded-lg px-3 py-2 text-sm bg-gh-canvas text-gh-text focus:outline-none focus:ring-2 focus:ring-[#2f81f7] ${className}`}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

export function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gh-border">
            {headers.map((h) => (
              <th key={h} className="text-left px-4 py-3 font-semibold text-gh-muted whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">{children}</tbody>
      </table>
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone = "slate",
  href,
}: {
  label: string;
  value: number | string;
  tone?: "slate" | "blue" | "amber" | "emerald" | "red" | "purple";
  href?: string;
}) {
  const tones = {
    slate: "text-gh-text",
    blue: "text-[#58a6ff]",
    amber: "text-[#d29922]",
    emerald: "text-[#3fb950]",
    red: "text-[#f85149]",
    purple: "text-[#bc8cff]",
  };
  const body = (
    <>
      <p className="text-xs font-medium text-gh-muted uppercase tracking-wide">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${tones[tone]}`}>{value}</p>
    </>
  );
  if (href) {
    return (
      <Link href={href} className="block rounded-xl border border-gh-border bg-gh-panel shadow-glass p-5 glass-hover hover:border-[#58a6ff]/60">
        {body}
      </Link>
    );
  }
  return <Card className="p-5">{body}</Card>;
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin h-8 w-8 border-4 border-[#2f81f7] border-t-transparent rounded-full" />
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="py-12 text-center text-gh-faint text-sm">{message}</div>;
}

/* ------------------------------------------------------------------ */
/* Super-admin cockpit primitives (glass / GitHub dark)                */
/* ------------------------------------------------------------------ */

export function GlassPanel({
  children,
  className = "",
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const interactive = onClick
    ? "glass-hover cursor-pointer"
    : "";
  return (
    <div className={`glass glass-hover rounded-2xl ${interactive} ${className}`} onClick={onClick}>
      {children}
    </div>
  );
}

export function Chip({
  children,
  active = false,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? "bg-[#2f81f7] text-white shadow-glow"
          : "text-[#9198a1] hover:text-[#e6edf3] hover:bg-white/[0.06]"
      } ${onClick ? "" : "cursor-default"} ${className}`}
    >
      {children}
    </button>
  );
}

export function KpiTile({
  label,
  value,
  sub,
  tone,
  href,
  index,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone: "slate" | "blue" | "green" | "amber" | "red" | "purple" | "cyan";
  href?: string;
  index?: number;
}) {
  const tones: Record<string, string> = {
    slate: "text-[#e6edf3]",
    blue: "text-[#58a6ff]",
    green: "text-[#3fb950]",
    amber: "text-[#d29922]",
    red: "text-[#f85149]",
    purple: "text-[#bc8cff]",
    cyan: "text-[#39d2c0]",
  };
  const accents: Record<string, string> = {
    slate: "bg-white/[0.06]",
    blue: "bg-[#58a6ff]/12",
    green: "bg-[#3fb950]/12",
    amber: "bg-[#d29922]/12",
    red: "bg-[#f85149]/12",
    purple: "bg-[#bc8cff]/12",
    cyan: "bg-[#39d2c0]/12",
  };
  const body = (
    <div className="flex items-start justify-between">
      <div className="min-w-0">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-[#9198a1]">{label}</p>
        <p className={`mt-2 font-mono mono-num text-3xl font-bold leading-none ${tones[tone]}`}>{value}</p>
        {sub && <p className="mt-2 truncate text-xs text-[#7d8590]">{sub}</p>}
      </div>
      {index != null && (
        <span className="font-mono mono-num text-[0.65rem] text-[#484f58]">{String(index).padStart(2, "0")}</span>
      )}
    </div>
  );
  const base = `glass glass-hover rounded-2xl p-5 flex flex-col justify-between`;
  if (href) {
    const toneClass = `absolute inset-x-0 top-0 h-0.5 rounded-t-2xl ${accents[tone]}`;
    return (
      <a href={href} className={`${base} relative hover:-translate-y-0.5`}>
        <span className={toneClass} />
        {body}
      </a>
    );
  }
  return (
    <div className={`${base} relative`}>
      <span className={`absolute inset-x-0 top-0 h-0.5 rounded-t-2xl ${accents[tone]}`} />
      {body}
    </div>
  );
}