"use client";

/**
 * Role-based access helpers for the web dashboard.
 */

export type RoleName =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "HOD"
  | "REGIONAL_ADMIN"
  | "AREA_MANAGER"
  | "BRANCH_MANAGER"
  | "HR"
  | "AUDITOR";

export const GLOBAL_SCOPE_ROLES: string[] = ["SUPER_ADMIN", "ADMIN", "HOD", "AUDITOR"];

export function userRoles(user: any | null): string[] {
  if (!user) return [];
  if (Array.isArray(user.roles)) {
    return user.roles.map((r: any) => (typeof r === "string" ? r : r?.name)).filter(Boolean);
  }
  return [];
}

export function isGlobalScope(user: any | null): boolean {
  return userRoles(user).some((r) => GLOBAL_SCOPE_ROLES.includes(r));
}

export function isSuperAdmin(user: any | null): boolean {
  return userRoles(user).includes("SUPER_ADMIN");
}

export function hasRole(user: any | null, role: string): boolean {
  return userRoles(user).includes(role);
}

export function canAccessPage(user: any | null, pathname: string | null): boolean {
  return true;
}

export function visibleNav(nav: { href: string; label: string; icon: string }[], user: any | null) {
  return nav;
}
