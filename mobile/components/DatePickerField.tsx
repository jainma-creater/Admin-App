import { useState, useMemo } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal } from "react-native";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const toLocal = (y: number, m: number, d: number) =>
  new Date(y, m, d, 12, 0, 0, 0);

const fmt = (dt: Date) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate()
  ).padStart(2, "0")}`;

const parseIso = (iso: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  return toLocal(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};

const fmtDisplay = (dt: Date) =>
  `${String(dt.getDate()).padStart(2, "0")} ${MONTHS[dt.getMonth()].slice(
    0,
    3
  )} ${dt.getFullYear()}`;

export default function DatePickerField({
  value,
  onChange,
  placeholder = "Select date",
  required = false,
}: {
  value: string;
  onChange: (date: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseIso(value), [value]);
  const today = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);
  const [viewMonth, setViewMonth] = useState(() => {
    const base = selected ?? today;
    return { year: base.getFullYear(), month: base.getMonth() };
  });

  const cells = useMemo(() => {
    const first = new Date(viewMonth.year, viewMonth.month, 1);
    const lead = first.getDay();
    const daysInMonth = new Date(viewMonth.year, viewMonth.month + 1, 0).getDate();
    const list: (Date | null)[] = [];
    for (let i = 0; i < lead; i++) list.push(null);
    for (let d = 1; d <= daysInMonth; d++) list.push(toLocal(viewMonth.year, viewMonth.month, d));
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [viewMonth]);

  const weeks = useMemo(() => {
    const out: (Date | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [cells]);

  const shift = (delta: number) =>
    setViewMonth((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  const pick = (d: Date) => {
    onChange(fmt(d));
    setOpen(false);
  };

  const isToday = (d: Date) => fmt(d) === fmt(today);
  const isSelected = (d: Date) => fmt(d) === value;

  return (
    <>
      <TouchableOpacity style={styles.field} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={[styles.fieldValue, !selected && styles.placeholder]}>
          {selected ? fmtDisplay(selected) : placeholder}
        </Text>
        <Text style={styles.calendarIcon}>📅</Text>
      </TouchableOpacity>

      <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.sheet}>
            <Text style={styles.title}>
              {required ? "Target Date (Required)" : "Select Date"}
            </Text>

            <View style={styles.navRow}>
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() => shift(-1)}
                hitSlop={10}
              >
                <Text style={styles.navText}>◀</Text>
              </TouchableOpacity>
              <Text style={styles.monthLabel}>
                {MONTHS[viewMonth.month]} {viewMonth.year}
              </Text>
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() => shift(1)}
                hitSlop={10}
              >
                <Text style={styles.navText}>▶</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAYS.map((w) => (
                <Text key={w} style={styles.weekLabel}>
                  {w}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {weeks.map((week, wi) => (
                <View key={wi} style={styles.calWeekRow}>
                  {week.map((d, i) =>
                    d ? (
                      <TouchableOpacity
                        key={i}
                        style={[
                          styles.dayCell,
                          isSelected(d) && styles.daySelected,
                        ]}
                        onPress={() => pick(d)}
                      >
                        <Text
                          style={[
                            styles.dayText,
                            isToday(d) && !isSelected(d) && styles.dayToday,
                            isSelected(d) && styles.dayTextSelected,
                          ]}
                        >
                          {d.getDate()}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <View key={i} style={styles.dayCell} />
                    )
                  )}
                </View>
              ))}
            </View>

            <View style={styles.footerRow}>
              {selected ? (
                <TouchableOpacity onPress={() => setOpen(false)} style={styles.todayBtn}>
                  <Text style={styles.todayText}>Done · {fmtDisplay(selected)}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={() => pick(today)} style={styles.todayBtn}>
                  <Text style={styles.todayText}>Today</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#f8fafc",
    borderColor: "#cbd5e1",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  fieldValue: { fontSize: 15, color: "#0f172a" },
  placeholder: { color: "#94a3b8" },
  calendarIcon: { fontSize: 18 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  sheet: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
  },
  title: { fontSize: 16, fontWeight: "700", color: "#0f172a", textAlign: "center" },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16 },
  navBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef2ff",
  },
  navText: { fontSize: 14, color: "#2563eb", fontWeight: "700" },
  monthLabel: { fontSize: 16, fontWeight: "600", color: "#334155" },
  weekRow: { flexDirection: "row", marginTop: 14 },
  weekLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "700",
    color: "#94a3b8",
  },
  grid: { marginTop: 6 },
  calWeekRow: { flexDirection: "row" },
  dayCell: {
    flex: 1,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    margin: 1,
  },
  dayText: { fontSize: 15, color: "#334155" },
  daySelected: { backgroundColor: "#2563eb", borderRadius: 18 },
  dayToday: { color: "#2563eb", fontWeight: "700" },
  dayTextSelected: { color: "#fff", fontWeight: "700" },
  footerRow: { alignItems: "center", marginTop: 8 },
  todayBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#dbeafe",
  },
  todayText: { fontSize: 14, fontWeight: "700", color: "#2563eb" },
});