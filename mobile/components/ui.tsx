import { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  StyleSheet,
  TextInputProps,
  Platform,
  ViewStyle,
  StyleProp,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import {
  colors,
  radius,
  spacing,
  type,
  shadows,
  brandGradient,
  typography,
} from "../lib/theme";

/* ------------------------------------------------------------------ */
/* FormField                                                           */
/* ------------------------------------------------------------------ */

type FieldProps = TextInputProps & {
  label: string;
  icon?: React.ReactNode;
  error?: string | null;
  secureToggle?: boolean;
  hint?: string;
};

export function FormField({ label, icon, error, secureToggle, hint, ...rest }: FieldProps) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);

  const isSecure = rest.secureTextEntry === true || secureToggle === true;
  const toggleSecure = () => setHidden((h) => !h);

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputRow,
          focused && styles.inputRowFocused,
          error && styles.inputRowError,
        ]}
      >
        {icon ? <View style={styles.icon}>{icon}</View> : null}
        <TextInput
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.brandLight}
          {...rest}
          secureTextEntry={isSecure && hidden}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[styles.input, rest.style]}
        />
        {isSecure && (
          <TouchableOpacity
            onPress={toggleSecure}
            hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
            style={styles.eye}
            accessibilityLabel={hidden ? "Show password" : "Hide password"}
            accessibilityRole="button"
          >
            <Ionicons
              name={hidden ? "eye-off-outline" : "eye-outline"}
              size={22}
              color={focused ? colors.brandLight : colors.textFaint}
            />
          </TouchableOpacity>
        )}
      </View>
      {hint && !error ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* PrimaryButton                                                       */
/* ------------------------------------------------------------------ */

type BtnProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  variant = "primary",
  icon,
  style,
}: BtnProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 0 }).start();

  const isDisabled = disabled || loading;

  if (variant === "ghost") {
    return (
      <TouchableOpacity
        style={[styles.ghostBtn, isDisabled && styles.disabled, style]}
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.7}
      >
        {loading ? <ActivityIndicator color={colors.brandLight} /> : <Text style={styles.ghostText}>{label}</Text>}
      </TouchableOpacity>
    );
  }

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        disabled={isDisabled}
        activeOpacity={0.92}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <LinearGradient
          colors={[...brandGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.btn, isDisabled && styles.disabled]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={styles.btnInner}>
              {icon}
              <Text style={styles.btnText}>{label}</Text>
            </View>
          )}
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */
/* Chip                                                                */
/* ------------------------------------------------------------------ */

type ChipProps = {
  label: string;
  icon?: string;
  selected: boolean;
  onPress: () => void;
};

export function Chip({ label, icon, selected, onPress }: ChipProps) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      {icon ? <Text style={{ fontSize: 15, marginRight: 6 }}>{icon}</Text> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
      {selected ? <Text style={styles.chipCheck}>✓</Text> : null}
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* LinkText                                                            */
/* ------------------------------------------------------------------ */

export function LinkText({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
      <Text style={styles.link}>{label}</Text>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/* ------------------------------------------------------------------ */
/* SectionHeader                                                       */
/* ------------------------------------------------------------------ */

export function SectionHeader({
  title,
  subtitle,
  action,
  style,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionHeader, style]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Badge / StatusPill                                                  */
/* ------------------------------------------------------------------ */

export function Badge({
  label,
  color,
  bg,
  icon,
  style,
}: {
  label: string;
  color: string;
  bg?: string;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: bg ?? colors.surfaceAlt }, style]}>
      {icon}
      <Text style={[styles.badgeText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* EmptyState                                                          */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon = "📭",
  title,
  message,
  action,
}: {
  icon?: string;
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* StatCard                                                            */
/* ------------------------------------------------------------------ */

export function StatCard({
  value,
  label,
  icon,
  accent = colors.brandLight,
  onPress,
  style,
}: {
  value: string | number;
  label: string;
  icon?: string;
  accent?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const Container: any = onPress ? TouchableOpacity : View;
  return (
    <Container style={[styles.statCard, style]} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.statTop}>
        {icon ? <Text style={styles.statIcon}>{icon}</Text> : null}
        <View style={[styles.statAccent, { backgroundColor: accent }]} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
    </Container>
  );
}

/* ------------------------------------------------------------------ */
/* IconButton                                                          */
/* ------------------------------------------------------------------ */

export function IconButton({
  name,
  onPress,
  color = colors.text,
  size = 22,
  style,
  accessibilityLabel,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.iconButton, style]}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Ionicons name={name} size={size} color={color} />
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/* Divider                                                             */
/* ------------------------------------------------------------------ */

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

const styles = StyleSheet.create({
  label: {
    color: colors.textMuted,
    fontSize: type.label,
    fontWeight: "700",
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 52,
    ...shadows.input,
  },
  inputRowFocused: {
    borderColor: colors.brandLight,
    borderWidth: 1.5,
  },
  inputRowError: {
    borderColor: colors.danger,
  },
  icon: {
    marginLeft: 14,
    marginRight: 4,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: type.body,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 14 : 12,
  },
  eye: {
    paddingHorizontal: 14,
  },
  fieldError: {
    color: colors.danger,
    fontSize: type.small,
    marginTop: 5,
    marginLeft: 2,
  },
  fieldHint: {
    color: colors.textFaint,
    fontSize: type.small,
    marginTop: 5,
    marginLeft: 2,
  },
  btn: {
    borderRadius: radius.md,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.glow,
  },
  btnInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  btnText: {
    color: colors.white,
    fontSize: type.body,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  ghostBtn: {
    borderRadius: radius.md,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  ghostText: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  disabled: { opacity: 0.55 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipSelected: {
    borderColor: colors.brandLight,
    backgroundColor: colors.brandSubtle,
  },
  chipText: {
    color: colors.textMuted,
    fontSize: type.label,
    fontWeight: "700",
  },
  chipTextSelected: {
    color: colors.brandLight,
  },
  chipCheck: {
    color: colors.sky,
    fontSize: type.label,
    fontWeight: "800",
    marginLeft: 5,
  },
  link: {
    color: colors.brandLight,
    fontSize: type.body,
    fontWeight: "700",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  sectionTitle: { ...typography.subheading },
  sectionSubtitle: { color: colors.textMuted, fontSize: type.small, marginTop: 2 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    gap: 5,
  },
  badgeText: { fontSize: type.small, fontWeight: "800", letterSpacing: 0.2 },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: { fontSize: 40, marginBottom: spacing.md },
  emptyTitle: { ...typography.subheading, textAlign: "center" },
  emptyMessage: {
    color: colors.textMuted,
    fontSize: type.body,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 20,
  },
  statCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  statTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  statIcon: { fontSize: 22 },
  statAccent: { width: 10, height: 10, borderRadius: 5 },
  statValue: { ...typography.title },
  statLabel: { color: colors.textMuted, fontSize: type.small, marginTop: 4, lineHeight: 15 },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
});
