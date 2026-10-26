import type { ViewProps } from "react-native";

/** The native event of a hardware keyboard Enter press. */
export type HardwareEnterEvent = { nativeEvent: { shift: boolean } };

export type HardwareKeyboardViewProps = ViewProps & {
  /** Reports hardware Enter presses while `true`. */
  enabled: boolean;
  /** Receives each hardware Enter press with its Shift state. */
  onHardwareEnter: (event: HardwareEnterEvent) => void;
};
