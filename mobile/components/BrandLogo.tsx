import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, radius, logoGradient, type } from "../lib/theme";

/**
 * Brand mark: a rounded gradient tile with a "BV" monogram + a small branch
 * glyph below the letters. Pure RN views — no image assets required.
 */
export function BrandLogo({ size = 72, dark = true }: { size?: number; dark?: boolean }) {
  const tile = size;
  const monogram = tile * 0.34;
  return (
    <View
      style={{
        width: tile,
        height: tile,
        borderRadius: tile * 0.28,
        overflow: "hidden",
        shadowColor: "#000",
        shadowOpacity: 0.45,
        shadowOffset: { width: 0, height: 8 },
        shadowRadius: 16,
        elevation: 8,
      }}
    >
      <LinearGradient colors={[...logoGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#fff", fontSize: monogram, fontWeight: "800", letterSpacing: -1 }}>BV</Text>
        <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: -2 }}>
          <View style={[styles.glyph, { width: size * 0.13, height: size * 0.15 }]} />
          <View style={[styles.glyph, { width: size * 0.05, height: size * 0.20, marginLeft: 2 }]} />
          <View style={[styles.glyph, { width: size * 0.13, height: size * 0.13, marginLeft: 2 }]} />
        </View>
      </LinearGradient>
    </View>
  );
}

export function BrandWordmark({ dark = false }: { dark?: boolean }) {
  return (
    <View style={{ alignItems: "center" }}>
      <Text style={{ color: dark ? colors.white : colors.text, fontSize: type.heading, fontWeight: "800", letterSpacing: -0.3 }}>
        Branch Visit
      </Text>
      <Text style={{ color: dark ? colors.textMuted : colors.textMuted, fontSize: type.small, marginTop: 2, letterSpacing: 0.6, textTransform: "uppercase" }}>
        Inspection & Compliance
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  glyph: { backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 4 },
});