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
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius, spacing, type, shadows, brandGradient } from "../lib/theme";
import { Ionicons } from "@expo/vector-icons";

type FieldProps = TextInputProps & {
  label: string;
  icon?: React.ReactNode;
  error?: string | null;
  secureToggle?: boolean;
};

export function FormField({ label, icon, error, secureToggle, ...rest }: FieldProps) {
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
            <Ionicons name={hidden ? "eye-off-outline" : "eye-outline"} size={22} color={focused ? colors.brandLight : colors.textFaint} />
          </TouchableOpacity>
        )}
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

type BtnProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "ghost";
};

export function PrimaryButton({ label, onPress, loading, disabled, variant = "primary" }: BtnProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 0 }).start();

  const isDisabled = disabled || loading;

  if (variant === "ghost") {
    return (
      <TouchableOpacity style={[styles.ghostBtn, isDisabled && styles.disabled]} onPress={onPress} disabled={isDisabled} activeOpacity={0.7}>
        {loading ? <ActivityIndicator color={colors.brandLight} /> : <Text style={styles.ghostText}>{label}</Text>}
      </TouchableOpacity>
    );
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} disabled={isDisabled} activeOpacity={0.92}>
        <LinearGradient
          colors={[...brandGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.btn, isDisabled && styles.disabled]}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>{label}</Text>}
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

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
    >
      {icon ? <Text style={{ fontSize: 15, marginRight: 6 }}>{icon}</Text> : null}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
      {selected ? <Text style={styles.chipCheck}>✓</Text> : null}
    </TouchableOpacity>
  );
}

export function LinkText({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
      <Text style={styles.link}>{label}</Text>
    </TouchableOpacity>
  );
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
  btn: {
    borderRadius: radius.md,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
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
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  chipSelected: {
    borderColor: colors.brandLight,
    backgroundColor: "rgba(37,99,235,0.18)",
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
});