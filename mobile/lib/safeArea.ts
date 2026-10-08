import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Platform } from "react-native";

/**
 * Top padding for the gradient/custom in-screen headers so the header never
 * hides behind the status bar / notch / punch-hole. Fixes headers being cut
 * off on devices with tall or under-display cameras.
 *
 * Returns an object to spread onto the header style: `{ paddingTop }`.
 */
export function useHeaderTop(): { paddingTop: number } {
  const insets = useSafeAreaInsets();
  const base = Platform.OS === "ios" ? 8 : 14;
  return { paddingTop: insets.top + base };
}