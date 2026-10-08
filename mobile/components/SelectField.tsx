import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  Animated,
  StyleSheet,
  Platform,
  TextInput,
} from "react-native";
import { colors, radius, spacing, type, shadows } from "../lib/theme";

export type SelectOption = { id: string; label: string; hint?: string };

type Props = {
  label: string;
  placeholder: string;
  value?: SelectOption | null;
  options: SelectOption[];
  onSelect: (opt: SelectOption) => void;
  error?: string | null;
  disabled?: boolean;
  emptyMessage?: string;
};

export function SelectField({
  label,
  placeholder,
  value,
  options,
  onSelect,
  error,
  disabled,
  emptyMessage = "No options available",
}: Props) {
  const [open, setOpen] = useState(false);
  const slide = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) {
      slide.setValue(0);
      fade.setValue(0);
      setQuery("");
      Animated.parallel([
        Animated.timing(slide, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 160, useNativeDriver: true }),
      ]).start();
    }
  }, [open]);

  const filteredOptions = options.filter((o) =>
    `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  const pick = (opt: SelectOption) => {
    setOpen(false);
    onSelect(opt);
  };

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={[styles.field, error && styles.fieldError, disabled && styles.disabled]}
        onPress={() => setOpen(true)}
        disabled={disabled}
        activeOpacity={0.85}
      >
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>
          {value ? value.label : placeholder}
        </Text>
        <Text style={styles.chevron}>⌄</Text>
      </TouchableOpacity>
      {error ? <Text style={styles.fieldErrorText}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <Animated.View
            style={[
              styles.sheet,
              {
                opacity: fade,
                transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }],
              },
            ]}
          >
            <View style={styles.handleRow}>
              <View style={styles.handle} />
            </View>
            <Text style={styles.sheetTitle}>{label}</Text>
            <TextInput
              style={styles.searchInput}
              placeholder={`Search ${label.toLowerCase()}...`}
              placeholderTextColor={colors.textFaint}
              value={query}
              onChangeText={setQuery}
              autoFocus={false}
            />
            <FlatList
              data={filteredOptions}
              keyExtractor={(o) => o.id}
              keyboardShouldPersistTaps="handled"
              style={{ flexGrow: 0 }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>{emptyMessage}</Text>
              }
              renderItem={({ item }) => {
                const selected = value?.id === item.id;
                return (
                  <TouchableOpacity
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => pick(item)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                        {item.label}
                      </Text>
                      {item.hint ? <Text style={styles.optionHint}>{item.hint}</Text> : null}
                    </View>
                    {selected ? <Text style={styles.optionCheck}>✓</Text> : null}
                  </TouchableOpacity>
                );
              }}
            />
          </Animated.View>
        </TouchableOpacity>
      </Modal>
    </View>
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
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 52,
    paddingHorizontal: 14,
    ...shadows.input,
  },
  fieldError: { borderColor: colors.danger },
  disabled: { opacity: 0.5 },
  value: { color: colors.text, fontSize: type.body, flex: 1 },
  placeholder: { color: colors.textFaint },
  chevron: { color: colors.textMuted, fontSize: 18, marginLeft: 8 },
  fieldErrorText: { color: colors.danger, fontSize: type.small, marginTop: 5, marginLeft: 2 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(4,8,18,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: spacing.lg,
    paddingBottom: Platform.OS === "ios" ? 34 : 22,
    paddingTop: 10,
    maxHeight: "68%",
  },
  handleRow: { alignItems: "center", marginBottom: 10 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong },
  sheetTitle: {
    color: colors.text,
    fontSize: type.subheading,
    fontWeight: "800",
    marginBottom: 12,
  },
  emptyText: {
    color: colors.textFaint,
    fontSize: type.body,
    paddingVertical: 22,
    textAlign: "center",
  },
  searchInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    minHeight: 44,
    paddingHorizontal: 14,
    marginBottom: 12,
    color: colors.text,
    fontSize: type.body,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionSelected: {
    borderColor: colors.brandLight,
    backgroundColor: "rgba(37,99,235,0.16)",
  },
  optionText: { color: colors.text, fontSize: type.body, fontWeight: "700" },
  optionTextSelected: { color: colors.brandLight },
  optionHint: { color: colors.textFaint, fontSize: type.small, marginTop: 2 },
  optionCheck: { color: colors.sky, fontSize: 16, fontWeight: "800", marginLeft: 8 },
});