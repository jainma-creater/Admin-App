import { Tabs } from "expo-router";
import { Text, Platform, View, useWindowDimensions } from "react-native";
import type { ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  // Dynamic tab bar height based on screen size and safe area
  const isSmallScreen = screenHeight < 667; // iPhone SE / small Android
  const tabBarHeight = isSmallScreen 
    ? (Platform.OS === "ios" ? 80 : 56)
    : (Platform.OS === "ios" ? 88 : 64);
  const tabBarPaddingBottom = isSmallScreen
    ? (Platform.OS === "ios" ? 24 : Math.max(insets.bottom, 8))
    : (Platform.OS === "ios" ? 28 : Math.max(insets.bottom, 10));

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#2563eb",
        tabBarInactiveTintColor: "#64748b",
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#e2e8f0",
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingBottom: tabBarPaddingBottom,
          paddingTop: 8,
          elevation: 8,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.06,
          shadowRadius: 6,
        },
        tabBarLabelStyle: {
          fontSize: isSmallScreen ? 10 : 12,
          fontWeight: "700",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }: { color: ColorValue; focused: boolean }) => (
            <Text style={{ fontSize: 20 }}>{focused ? "🏢" : "🏬"}</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="visits"
        options={{
          title: "My Visits",
          tabBarIcon: ({ color, focused }: { color: ColorValue; focused: boolean }) => (
            <Text style={{ fontSize: 20 }}>{focused ? "📋" : "📄"}</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile & Sync",
          tabBarIcon: ({ color, focused }: { color: ColorValue; focused: boolean }) => (
            <Text style={{ fontSize: 20 }}>{focused ? "👤" : "👥"}</Text>
          ),
        }}
      />
    </Tabs>
  );
}
