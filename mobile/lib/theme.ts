import { useWindowDimensions, Platform } from "react-native";

/**
 * Central design system for the Branch Visit mobile app.
 *
 * ONE theme for the whole app: a clean, light, enterprise palette with a blue
 * brand accent that mirrors the web dashboard. Screens must pull colours/sizes
 * from here (no literal hex) so the UI stays consistent across every device.
 * New code should prefer the semantic tokens (typography.*, spacing.*,
 * radius.*, shadows.*) and the `useResponsive()` hook for layout decisions.
 *
 * The auth flow intentionally keeps a branded dark gradient background while
 * its card/inputs use the same light tokens as the rest of the app.
 */

export const colors = {
  // Backgrounds
  bg: "#F5F7FB",
  bgDeep: "#E9EEF6",
  surface: "#FFFFFF",
  surfaceAlt: "#F1F5F9",
  surfaceElevated: "#FFFFFF",
  surfaceSubtle: "#F8FAFC",

  // Lines
  border: "#E5EAF1",
  borderStrong: "#CBD5E1",
  borderFocus: "#2563EB",

  // Text
  text: "#0F172A",
  textMuted: "#64748B",
  textFaint: "#94A3B8",
  textInverse: "#FFFFFF",

  // Brand
  brand: "#2563EB",
  brandDark: "#1D4ED8",
  brandLight: "#3B82F6",
  brandSubtle: "#EFF6FF",
  sky: "#0EA5E9",

  // Semantic
  success: "#10B981",
  successLight: "#34D399",
  successSubtle: "#ECFDF5",
  warning: "#F59E0B",
  warningLight: "#FBBF24",
  warningSubtle: "#FFFBEB",
  danger: "#EF4444",
  dangerLight: "#F87171",
  dangerSubtle: "#FEF2F2",
  info: "#06B6D4",
  infoSubtle: "#ECFEFF",

  // Misc
  white: "#FFFFFF",
  black: "#000000",
  inputBg: "#F8FAFC",
  overlay: "rgba(15, 23, 42, 0.45)",
  overlayStrong: "rgba(15, 23, 42, 0.7)",
  disabled: "#E2E8F0",
  disabledText: "#94A3B8",
} as const;

export const gradients = {
  brand: ["#1D4ED8", "#2563EB", "#3B82F6"] as const,
  brandHorizontal: ["#1D4ED8", "#2563EB"] as const,
  auth: ["#0B1120", "#0D1526", "#101C38"] as const,
  logo: ["#1D4ED8", "#2563EB", "#38BDF8"] as const,
  success: ["#059669", "#10B981"] as const,
  warning: ["#D97706", "#F59E0B"] as const,
  danger: ["#DC2626", "#EF4444"] as const,
  surface: ["#FFFFFF", "#F8FAFC"] as const,
  card: ["#FFFFFF", "#F1F5F9"] as const,
};

// Backwards-compatible named gradients (older screens import these directly).
export const brandGradient = gradients.brand;
export const authGradient = gradients.auth;
export const logoGradient = gradients.logo;

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  xxl: 30,
  pill: 999,
  circle: 9999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 26,
  xxxl: 34,
  // numeric scale for new code
  n1: 4,
  n2: 8,
  n3: 12,
  n4: 16,
  n5: 20,
  n6: 24,
  n8: 32,
  n10: 40,
  n12: 48,
} as const;

// Legacy short-name font sizes used widely by existing screens.
export const type = {
  title: 26,
  heading: 20,
  subheading: 16,
  body: 14.5,
  label: 12.5,
  small: 11.5,
  caption: 10.5,
} as const;

export const fontSize = {
  xs: 10.5,
  sm: 11.5,
  base: 14.5,
  md: 15.5,
  lg: 17,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
} as const;

export const fontWeight = {
  normal: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
  extrabold: "800" as const,
};

// Semantic text presets. Screens should spread these in.
export const typography = {
  display: { fontSize: 30, fontWeight: fontWeight.extrabold, letterSpacing: -0.5, color: colors.text },
  title: { fontSize: 26, fontWeight: fontWeight.extrabold, letterSpacing: -0.4, color: colors.text },
  heading: { fontSize: 20, fontWeight: fontWeight.bold, letterSpacing: -0.2, color: colors.text },
  subheading: { fontSize: 16, fontWeight: fontWeight.bold, color: colors.text },
  body: { fontSize: 14.5, fontWeight: fontWeight.normal, color: colors.text },
  bodyStrong: { fontSize: 14.5, fontWeight: fontWeight.semibold, color: colors.text },
  small: { fontSize: 11.5, fontWeight: fontWeight.normal, color: colors.textMuted },
  label: { fontSize: 12.5, fontWeight: fontWeight.semibold, letterSpacing: 0.3, color: colors.textMuted },
  caption: { fontSize: 10.5, fontWeight: fontWeight.normal, color: colors.textFaint },
  button: { fontSize: 15, fontWeight: fontWeight.bold, letterSpacing: 0.2 },
  mono: {
    fontSize: 12.5,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    color: colors.text,
  },
} as const;

export const shadows = {
  card: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 3,
  },
  input: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  none: {
    shadowColor: "transparent",
    shadowOpacity: 0,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 0,
    elevation: 0,
  },
  sm: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 4,
  },
  lg: {
    shadowColor: "#0F172A",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 22,
    elevation: 8,
  },
  glow: {
    shadowColor: colors.brand,
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 5,
  },
  glowSuccess: {
    shadowColor: colors.success,
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 5,
  },
  glowDanger: {
    shadowColor: colors.danger,
    shadowOpacity: 0.28,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 5,
  },
} as const;

export const transitions = {
  fast: 150,
  normal: 200,
  slow: 300,
  spring: { damping: 20, stiffness: 200 },
} as const;

export const breakpoints = {
  sm: 360,
  md: 480,
  lg: 600,
  xl: 768,
  xxl: 1024,
} as const;

export type Breakpoint = keyof typeof breakpoints;

export const getBreakpoint = (width: number): Breakpoint => {
  if (width >= breakpoints.xxl) return "xxl";
  if (width >= breakpoints.xl) return "xl";
  if (width >= breakpoints.lg) return "lg";
  if (width >= breakpoints.md) return "md";
  return "sm";
};

/**
 * Responsive helper for screens: gives device class, safe paddings and
 * type scale adjustments so the same screen reads well on a 4.7" phone, a
 * large phone and a tablet (and in landscape) without bespoke math per screen.
 */
export const useResponsive = () => {
  const { width, height } = useWindowDimensions();
  const breakpoint = getBreakpoint(width);
  const isSmall = width < breakpoints.md;
  const isTablet = width >= breakpoints.lg;
  const isLandscape = width > height;

  return {
    width,
    height,
    breakpoint,
    isSmall,
    isTablet,
    isLandscape,
    // Multi-column grids: 1 col on small phones, 2 on normal phones, more on tablets.
    columns: isTablet ? 4 : isSmall ? 2 : 2,
    gutter: isSmall ? spacing.md : spacing.lg,
    layout: {
      screenPadding: isTablet ? spacing.xxl : spacing.lg,
      cardPadding: isTablet ? spacing.xl : spacing.lg,
      sectionGap: isTablet ? spacing.xl : spacing.lg,
      cardMaxWidth: isTablet ? 560 : width - spacing.lg * 2,
      containerMaxWidth: isTablet ? 680 : width,
      headerHeight: isTablet ? 68 : 60,
    },
    scale: (n: number) => Math.round(n * (isSmall ? 0.95 : isTablet ? 1.08 : 1)),
  };
};

/**
 * Common status → colour mapping so EVERY screen renders a visit/checklist
 * status the same way. Keep this the single source of truth.
 */
export const statusTone = (status?: string | null) => {
  switch ((status ?? "").toUpperCase()) {
    case "OK":
    case "VERIFIED":
    case "SUBMITTED":
    case "APPROVED":
    case "DONE":
    case "COMPLETED":
      return { fg: colors.success, bg: colors.successSubtle, label: "success" as const };
    case "NOT_OK":
    case "NOT_FOUND":
    case "REJECTED":
    case "FAILED":
      return { fg: colors.danger, bg: colors.dangerSubtle, label: "danger" as const };
    case "IN_PROGRESS":
    case "PENDING":
    case "PARTIAL":
      return { fg: colors.warning, bg: colors.warningSubtle, label: "warning" as const };
    default:
      return { fg: colors.textMuted, bg: colors.surfaceAlt, label: "neutral" as const };
  }
};

export default colors;
