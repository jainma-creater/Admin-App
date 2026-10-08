import { Stack } from "expo-router";

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        contentStyle: { backgroundColor: "#f8fafc" },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="branch/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="branch/add" options={{ headerShown: false }} />
      <Stack.Screen name="visit/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="checklist/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="visit/[id]/summary" options={{ headerShown: false }} />
      <Stack.Screen name="visit/[id]/assets" options={{ headerShown: false }} />
      <Stack.Screen name="visit/[id]/it-assets" options={{ headerShown: false }} />
      <Stack.Screen
        name="camera"
        options={{
          headerShown: false,
          animation: "fade",
          presentation: "fullScreenModal",
        }}
      />
    </Stack>
  );
}

