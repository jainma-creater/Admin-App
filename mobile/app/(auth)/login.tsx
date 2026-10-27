import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useAuth } from "../../stores/auth";
import { api, getErrorMessage } from "../../lib/api";
import { BrandLogo, BrandWordmark } from "../../components/BrandLogo";
import { FormField, PrimaryButton, LinkText } from "../../components/ui";
import { colors, radius, spacing, type, authGradient, shadows } from "../../lib/theme";
import { StatusBar } from "expo-status-bar";

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
const [error, setError] = useState<string | null>(null);
const [loading, setLoading] = useState(false);
const [captcha, setCaptcha] = useState<{ token: string } | null>(null);

const fetchCaptcha = async () => {
  try {
    const { data } = await api.get("/auth/captcha");
    if (data.captcha === "disabled") {
      setCaptcha(null);
      return;
    }
    setCaptcha({ token: data.token });
  } catch {
    setCaptcha(null); // fail open: if captcha endpoint is down, still allow login
  }
};

useEffect(() => {
  fetchCaptcha();
}, []);

  const { width: SCREEN_WIDTH } = useWindowDimensions();
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, { toValue: 1, duration: 420, useNativeDriver: true }).start();
  }, []);

  // Responsive glow sizes based on screen width
  const glow1Size = Math.min(SCREEN_WIDTH * 0.85, 260);
  const glow2Size = Math.min(SCREEN_WIDTH * 0.95, 300);
  const glow1Top = -glow1Size * 0.35;
  const glow1Left = -glow1Size * 0.3;
  const glow2Bottom = -glow2Size * 0.35;
  const glow2Right = -glow2Size * 0.27;

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError("Please enter your email and password");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password, {
        token: captcha?.token,
        honeypot: "",
      });
      router.replace("/(app)");
    } catch (e: any) {
      const msg = await getErrorMessage(e);
      setError(msg);
      // CAPTCHA is one-time-use: refresh it so the next attempt works.
      if (captcha) {
        await fetchCaptcha();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <LinearGradient colors={[...authGradient]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.root}>
        {/* soft decorative glows — responsive */}
        <View style={[styles.glow, { top: glow1Top, left: glow1Left, width: glow1Size, height: glow1Size }]} />
        <View style={[styles.glow, { bottom: glow2Bottom, right: glow2Right, width: glow2Size, height: glow2Size, opacity: 0.35 }]} />

<ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="interactive"
        >
          <Animated.View style={[styles.content, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }]}>
            <View style={styles.card}>
              <View style={styles.brand}>
                <BrandLogo size={64} />
                <View style={{ marginTop: 14 }}>
                  <BrandWordmark />
                </View>
              </View>

              <Text style={styles.tagline}>Sign in to start verifying branches</Text>

              <FormField
                label="Email"
                placeholder="you@company.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                icon={<Text style={{ fontSize: 15 }}>✉️</Text>}
              />
              <FormField
                label="Password"
                placeholder="Your password"
                autoCapitalize="none"
                secureTextEntry
                secureToggle
                value={password}
                onChangeText={setPassword}
                icon={<Text style={{ fontSize: 15 }}>🔒</Text>}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={styles.forgotRow}>
                <LinkText label="Forgot password?" onPress={() => router.push("/(auth)/forgot-password")} />
              </View>

              <PrimaryButton label={loading ? "Signing in…" : "Sign In"} onPress={handleLogin} loading={loading} />

              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>New here?</Text>
                <View style={styles.divider} />
              </View>

              <TouchableOpacity style={styles.registerBtn} onPress={() => router.push("/(auth)/register")} activeOpacity={0.8}>
                <Text style={styles.registerText}>Create an Account</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </ScrollView>
      </LinearGradient>
      <StatusBar style="light" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: 40,
    paddingBottom: 26,
    overflow: "hidden",
  },
  glow: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "rgba(37,99,235,0.22)",
  },
  content: { flex: 1, justifyContent: "center" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  brand: { alignItems: "center", marginBottom: 20 },
  tagline: {
    color: colors.textMuted,
    fontSize: type.body,
    textAlign: "center",
    marginBottom: spacing.xl,
  },
  error: {
    color: colors.danger,
    fontSize: type.body,
    marginBottom: spacing.md,
  },
  forgotRow: { alignItems: "flex-end", marginBottom: spacing.lg },
  dividerRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.xl, marginBottom: spacing.md },
  divider: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textFaint, fontSize: type.small, marginHorizontal: 10 },
  registerBtn: {
    borderRadius: radius.md,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.brandLight,
    backgroundColor: "rgba(37,99,235,0.12)",
  },
  registerText: { color: colors.brandLight, fontSize: type.body, fontWeight: "800" },
  footer: {
    color: colors.textFaint,
    fontSize: type.small,
    textAlign: "center",
    marginTop: 24,
  },
});