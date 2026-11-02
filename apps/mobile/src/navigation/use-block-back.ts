import { useEffect } from "react";
import { BackHandler } from "react-native";

/**
 * While `blocked` is true, the Android Back button and the back gesture do nothing, so a sheet
 * stays open while its command runs and its result stays in view. React Native calls the newest
 * Back listener first, so this listener runs before the one of the navigator. The sheet can
 * still close through its navigation object.
 */
export const useBlockBack = (blocked: boolean): void => {
  useEffect(() => {
    if (!blocked) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [blocked]);
};
