import { useNavigationState, useRoute } from "expo-router/react-navigation";
import { Platform } from "react-native";
import type { ScreenStackProps } from "react-native-screens";

type StackNativeProps = Partial<Omit<ScreenStackProps, "children">>;

const everyScreen = (): boolean => true;
const NO_SWIPE: StackNativeProps = {};
const SWIPE: StackNativeProps = { goBackGesture: "swipeRight" };

/**
 * The swipe back of a stack on Android, for its `unstable_nativeProps`. iOS has its own
 * interactive back swipe. The Android native stack has none, so `SwipeBackProvider` moves the
 * screens while a finger moves to the end side. The swipe is on while the top screen is a
 * pushed screen: `pushed` tells which routes are, because a sheet closes with a swipe down.
 */
export const useSwipeBackNativeProps = (
  pushed: (routeName: string) => boolean = everyScreen,
): StackNativeProps => {
  const route = useRoute();
  const swipes = useNavigationState((state) => {
    const stack = state.routes.find((entry) => entry.key === route.key)?.state;
    if (!stack?.routes || stack.index === undefined || stack.index < 1) return false;
    const topRoute = stack.routes[stack.index];
    return topRoute !== undefined && pushed(topRoute.name);
  });
  return Platform.OS === "android" && swipes ? SWIPE : NO_SWIPE;
};
