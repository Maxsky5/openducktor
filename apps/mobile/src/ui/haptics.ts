import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * One haptic per user action, at the moment the visual change happens. Android uses view haptics,
 * which need no vibration permission. Haptics never carry meaning alone.
 */
export const haptics = {
  /** A value ticks to a new step: a segment, a picker value, a tab of a sheet. */
  selection: (): void => {
    if (Platform.OS === "ios") void Haptics.selectionAsync();
    else void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick);
  },
  /** A light physical event: a sheet detent, a swipe action that commits, a long press. */
  light: (): void => {
    if (Platform.OS === "ios") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click);
  },
  /** A command that the user started succeeded, such as a sent message. */
  success: (): void => {
    if (Platform.OS === "ios") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm);
  },
  /** A command that the user started failed. */
  error: (): void => {
    if (Platform.OS === "ios") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } else void Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Reject);
  },
};
