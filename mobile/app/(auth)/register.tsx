import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { api, getErrorMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { BrandLogo } from "../../components/BrandLogo";
import { FormField, PrimaryButton, Chip, LinkText } from "../../components/ui";
import { SelectField, SelectOption } from "../../components/SelectField";
import { colors, radius, spacing, type, authGradient, shadows } from "../../lib/theme";

type RoleOpt = {
  key: string;
  label: string;
  role: string;
  description: string | null;
};
type BranchOpt = { id: string; name: string; code: string; state?: string | null };
type AreaOpt = { id: string; name: string; code: string; branches: BranchOpt[] };
// Region branch carries its state name so the register can resolve "state →
// region" itself from the /auth/register-options tree ("in register I get
// the state and branch").
type RegionOpt = { id: string; name: string; code: string; state?: string | null; areas: AreaOpt[] };
type StateOpt = { name: string; branch_count: number };

const ROLE_ICONS: Record<string, string> = {
  hr: "👤",
  regional_admin: "🗺️",
  branch_ops: "🏦",
  other: "🔍",
};

const DEFAULT_ROLES: RoleOpt[] = [
  { key: "hr", label: "HR", role: "HR", description: "Staffing, welfare and records." },
  { key: "regional_admin", label: "Regional Admin", role: "REGIONAL_ADMIN", description: "Oversees a region." },
  { key: "branch_ops", label: "Branch Ops", role: "BRANCH_MANAGER", description: "Works in a single branch." },
  { key: "other", label: "Other", role: "AUDITOR", description: "Field inspection / auditor." },
];

export default function Register() {
  const { saveSession } = useAuth();
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [roles, setRoles] = useState<RoleOpt[]>(DEFAULT_ROLES);
  const [regions, setRegions] = useState<RegionOpt[]>([]);
  const [states, setStates] = useState<StateOpt[]>([]);
  const [optionsState, setOptionsState] = useState<"loading" | "ready" | "error">("loading");
  const [optionsAttempt, setOptionsAttempt] = useState(0);

  const [role, setRole] = useState<RoleOpt | null>(null);
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [region, setRegion] = useState<SelectOption | null>(null);
  const [area, setArea] = useState<SelectOption | null>(null);
  const [branch, setBranch] = useState<SelectOption | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showScopeHint, setShowScopeHint] = useState<boolean>(false);

  // Load role choices + org tree. Keyed on optionsAttempt so the error state
  // can retry without navigating away.
  useEffect(() => {
    let cancelled = false;
    setOptionsState("loading");
    (async () => {
      try {
        const { data } = await api.get("/auth/register-options");
        if (cancelled) return;
        if (data?.roles?.length) setRoles(data.roles);
        setRegions(data?.regions ?? []);
        setStates(data?.states ?? []);
        setOptionsState("ready");
      } catch {
        if (!cancelled) {
          setOptionsState("error");
          setRegions([]);
          setStates([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [optionsAttempt]);

  const selectedRegion = regions.find((r) => r.id === region?.id);
  const selectedArea = selectedRegion?.areas.find((a) => a.id === area?.id);

  // State-first: when the org has states (employee-master sheet 2), pick a
  // state first; the region list narrows to regions that carry that state.
  const hasStates = states.length > 0;
  const stateOptions: SelectOption[] = states.map((s) => ({
    id: s.name,
    label: s.branch_count > 0 ? `${s.name} (${s.branch_count})` : s.name,
  }));
  const regionOptions: SelectOption[] = regions
    .filter((r) => !hasStates || !selectedState || (r.state ?? r.name).toLowerCase() === selectedState.toLowerCase())
    .map((r) => ({ id: r.id, label: `${r.name} (${r.code})` }));
  const areaOptions: SelectOption[] =
    selectedRegion?.areas.map((a) => ({ id: a.id, label: `${a.name} (${a.code})` })) ?? [];
  const branchOptions: SelectOption[] =
    selectedArea?.branches.map((b) => ({ id: b.id, label: b.name })) ?? [];

  const pickState = (opt: SelectOption) => {
    setSelectedState(opt.id);
    // REGIONAL_ADMIN scopes by the state-region itself — resolve + preselect it.
    const stateRegion = regions.find(
      (r) => (r.state ?? r.name).toLowerCase() === opt.id.toLowerCase()
    );
    setRegion(stateRegion ? { id: stateRegion.id, label: stateRegion.name } : null);
    setArea(null);
    setBranch(null);
    setErrors((e) => ({ ...e, scope: "" }));
  };
  const pickRegion = (opt: SelectOption) => {
    setRegion(opt);
    setArea(null);
    setBranch(null);
    setErrors((e) => ({ ...e, scope: "" }));
  };
  const pickArea = (opt: SelectOption) => {
    setArea(opt);
    setBranch(null);
    setErrors((e) => ({ ...e, scope: "" }));
  };

  const requiresBranch = role?.role === "BRANCH_MANAGER";
  const requiresRegion = role?.role === "REGIONAL_ADMIN";

  const handleSubmit = async () => {
    const errs: Record<string, string> = {};
    if (!firstName.trim()) errs.firstName = "First name is required";
    if (!lastName.trim()) errs.lastName = "Last name is required";
    if (!email.trim() || !email.includes("@")) errs.email = "Enter a valid email";
    if (!password) errs.password = "Password is required";
    else if (password.length < 8) errs.password = "Minimum 8 characters";
    if (confirmPassword !== password) errs.confirmPassword = "Passwords do not match";
    if (!role) errs.role = "Choose how you'll use Branch Visit";
    if (requiresBranch && !branch) errs.scope = "Branch Ops accounts must select a branch";
    if (requiresRegion && hasStates && !selectedState) errs.scope = "Regional Admin accounts must select a state";
    if (requiresRegion && !hasStates && !region) errs.scope = "Regional Admin accounts must select a region";
    if (hasStates && !selectedState && requiresBranch) errs.scope = "Select your state, then branch";
    if (region && !requiresRegion && requiresBranch && !branch) errs.scope = "Select a branch to finish your scope";

    setErrors(errs);
    setSubmitError(null);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);
    try {
      const { data } = await api.post("/auth/register", {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        password,
        role: role!.role,
        state: hasStates ? selectedState : null,
        region_id: region?.id ?? null,
        area_id: area?.id ?? null,
        branch_id: branch?.id ?? null,
      });
      await saveSession(data);
      router.replace("/(app)");
    } catch (e: any) {
      setSubmitError(await getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <LinearGradient colors={[...authGradient]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.root}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 34, paddingTop: 34 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <BrandLogo size={52} />
            <Text style={styles.title}>Create Account</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.nameRow}>
              <View style={{ flex: 1 }}>
                <FormField
                  label="First name"
                  placeholder="Rahul"
                  autoCapitalize="words"
                  value={firstName}
                  onChangeText={setFirstName}
                  error={errors.firstName}
                />
              </View>
              <View style={{ width: 14 }} />
              <View style={{ flex: 1 }}>
                <FormField
                  label="Last name"
                  placeholder="Sharma"
                  autoCapitalize="words"
                  value={lastName}
                  onChangeText={setLastName}
                  error={errors.lastName}
                />
              </View>
            </View>

            <FormField
              label="Work email"
              placeholder="you@company.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              error={errors.email}
            />

            <FormField
              label="Password"
              placeholder="Minimum 8 characters"
              autoCapitalize="none"
              secureTextEntry
              secureToggle
              value={password}
              onChangeText={setPassword}
              error={errors.password}
            />

            <FormField
              label="Confirm password"
              placeholder="Re-enter password"
              autoCapitalize="none"
              secureTextEntry
              secureToggle
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              error={errors.confirmPassword}
            />

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Your role</Text>
              <Text style={styles.sectionHint}>This decides what you can see while verifying branches.</Text>
              {errors.role ? <Text style={styles.fieldError}>{errors.role}</Text> : null}
              <View style={styles.chipGrid}>
                {roles.map((r) => (
                  <View key={r.key} style={{ width: "48%" }}>
                    <Chip
                      label={r.label}
                      icon={ROLE_ICONS[r.key] ?? "•"}
                      selected={role?.key === r.key}
                      onPress={() => {
                        setRole(r);
                        setErrors((e) => ({ ...e, role: "" }));
                        setShowScopeHint(false);
                      }}
                    />
                  </View>
                ))}
              </View>
              {role ? (
                <Text style={styles.roleDesc}>{role.description}</Text>
              ) : null}
            </View>

            {role ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Your branch scope</Text>
                <Text style={styles.sectionHint}>
                  {requiresBranch
                    ? "You'll see only the branch you pick here while doing verifications."
                    : requiresRegion
                    ? "You'll operate across all areas under the region you pick."
                    : "Pick where you work — optional, you can change it later via the web console."}
                </Text>

                {showScopeHint && <Text style={styles.scopeHint}>Region → Area → Branch</Text>}

                {optionsState === "loading" ? (
                  <ActivityIndicator color={colors.brandLight} style={{ marginVertical: 18 }} />
                ) : optionsState === "error" ? (
                  <TouchableOpacity style={styles.reloadBtn} onPress={() => setOptionsAttempt((n) => n + 1)} activeOpacity={0.8}>
                    <Text style={styles.reloadText}>Couldn't load branches — tap to retry.</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    {hasStates && (
                      <SelectField
                        label="State"
                        placeholder="Select state"
                        value={selectedState ? { id: selectedState, label: selectedState } : null}
                        options={stateOptions}
                        onSelect={pickState}
                      />
                    )}
                    <SelectField
                      label={hasStates ? "Region (optional — pre-filled from state)" : "Region"}
                      placeholder={hasStates && selectedState ? region ? "Region selected" : "Select region" : "Select region"}
                      value={region}
                      options={regionOptions}
                      onSelect={pickRegion}
                    />
                    <SelectField
                      label="Area"
                      placeholder={region ? "Select area" : "Select a region first"}
                      value={area}
                      options={areaOptions}
                      onSelect={pickArea}
                      disabled={!region}
                    />
                    <SelectField
                      label="Branch"
                      placeholder={area ? "Select branch" : "Select an area first"}
                      value={branch}
                      options={branchOptions}
                      onSelect={(opt) => {
                        setBranch(opt);
                        setErrors((e) => ({ ...e, scope: "" }));
                      }}
                      disabled={!area}
                    />
                  </>
                )}

                {errors.scope ? <Text style={styles.fieldError}>{errors.scope}</Text> : null}
              </View>
            ) : null}

            {submitError ? <Text style={styles.submitError}>{submitError}</Text> : null}

            <PrimaryButton
              label={loading ? "Creating account…" : "Create Account"}
              onPress={handleSubmit}
              loading={loading}
            />

            <View style={styles.signInRow}>
              <Text style={styles.signInText}>Already have an account?</Text>
              <LinkText label="Sign In" onPress={() => router.replace("/(auth)/login")} />
            </View>
          </View>

          <Text style={styles.footer}>You'll be signed in immediately after creating your account.</Text>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}

const styles = {
  flex: { flex: 1 },
  root: { flex: 1, paddingHorizontal: 20 },
  header: { alignItems: "center", marginBottom: 22 },
  title: { color: colors.white, fontSize: type.heading, fontWeight: "800", marginTop: 12, letterSpacing: -0.3 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  nameRow: { flexDirection: "row" },
  section: { marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionTitle: { color: colors.white, fontSize: type.subheading, fontWeight: "800" },
  sectionHint: { color: colors.textMuted, fontSize: type.small, marginTop: 4, marginBottom: 12 },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 10 },
  roleDesc: { color: colors.sky, fontSize: type.small, marginTop: 10, fontStyle: "italic" },
  scopeHint: { color: colors.textFaint, fontSize: type.small, marginBottom: 10 },
  fieldError: { color: colors.danger, fontSize: type.small, marginTop: 4, marginBottom: 8 },
  submitError: { color: colors.danger, fontSize: type.body, marginBottom: spacing.md },
  story: { color: colors.warning, fontSize: type.small, marginBottom: 8 },
  signInRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: spacing.xl, gap: 6 },
  signInText: { color: colors.textMuted, fontSize: type.body },
  footer: { color: colors.textFaint, fontSize: type.small, textAlign: "center", marginTop: 20 },
  reloadBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 12, marginVertical: 10 },
  reloadText: { color: colors.textMuted, fontSize: type.small },
} as const;