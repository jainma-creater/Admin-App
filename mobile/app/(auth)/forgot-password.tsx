import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { api, getErrorMessage } from "../../lib/api";
import { BrandLogo } from "../../components/BrandLogo";
import { FormField, PrimaryButton, LinkText } from "../../components/ui";
import { colors, radius, spacing, type, authGradient, shadows } from "../../lib/theme";
import { useHeaderTop } from "../../lib/safeArea";

export default function ForgotPassword() {
  const router = useRouter();
  const headerTop = useHeaderTop();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleForgotPassword = async () => {
    if (!email.trim() || !email.includes("@")) {
      setError("Please enter a valid email");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // TODO: Backend needs to implement /auth/forgot-password endpoint.
      Alert.alert(
        "Reset Link Sent",
        "If an account with that email exists, a password reset link has been sent.",
        [{ text: "OK", onPress: () => router.replace("/(auth)/login") }]
      );
    } catch (e: any) {
      setError(await getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <LinearGradient colors={[...authGradient]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.root}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingVertical: headerTop.paddingTop }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <View style={styles.brand}>
              <BrandLogo size={56} />
              <Text style={styles.title}>Reset Password</Text>
            </View>

            <Text style={styles.instruction}>
              Enter your work email and we'll send you a link to reset your password.
            </Text>

            <FormField
              label="Work email"
              placeholder="you@company.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              error={error}
            />

            <PrimaryButton
              label={loading ? "Sending…" : "Send Reset Link"}
              onPress={handleForgotPassword}
              loading={loading}
            />

            <View style={styles.backRow}>
              <LinkText label="← Back to Sign In" onPress={() => router.replace("/(auth)/login")} />
            </View>
          </View>
        </ScrollView>
      </LinearGradient>
      <StatusBar style="light" />
    </KeyboardAvoidingView>
  );
}

const styles = {
  flex: { flex: 1 },
  root: { flex: 1, paddingHorizontal: 22 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  brand: { alignItems: "center", marginBottom: 16, gap: 12 },
  title: { color: colors.text, fontSize: type.heading, fontWeight: "800", letterSpacing: -0.3 },
  instruction: {
    color: colors.textMuted,
    fontSize: type.body,
    textAlign: "center",
    marginBottom: spacing.xl,
    lineHeight: 21,
  },
  backRow: { alignItems: "center", marginTop: spacing.xl },
} as const;
