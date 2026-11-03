import { StackActions } from "expo-router/react-navigation";

type PopAction = ReturnType<typeof StackActions.pop>;

/**
 * Closes the current screen or sheet in the event that asks for it. `goBack` and `router.back` go
 * through the routing queue of Expo Router, which adds a render and a scan of the whole tree before
 * the screen can close.
 */
export const closeScreen = (navigation: { dispatchSync: (action: PopAction) => void }): void => {
  navigation.dispatchSync(StackActions.pop());
};
