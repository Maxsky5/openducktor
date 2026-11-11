import type { ToolLifecyclePhase } from "@openducktor/frontend-core/sessions/messages/tool-lifecycle";
import type { ReactElement } from "react";
import { type StyleProp, type TextStyle, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Text } from "@/ui/text";
import { TOOL_STATUS } from "./tool-status-presentation";

/** The desktop `ToolStatusIcon`: the icon of the phase of a tool call, with its label. */
export function ToolStatusIcon({
  phase,
  decorative = false,
  colorValue,
}: {
  phase: ToolLifecyclePhase;
  /** True next to the visible label, so screen readers skip the icon. */
  decorative?: boolean;
  /** Replaces the color of the phase, such as for a quiet success in a log. */
  colorValue?: string | undefined;
}): ReactElement {
  const { desktop } = useAppTheme();
  const status = TOOL_STATUS[phase];
  const color = colorValue ?? status.color(desktop);
  return (
    <View
      style={styles.icon}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : "image"}
      accessibilityLabel={decorative ? undefined : status.label}
      importantForAccessibility={decorative ? "no-hide-descendants" : "auto"}
    >
      {status.icon === null ? (
        <LoaderSpinner size={12} color={color} />
      ) : (
        <Icon name={status.icon} size={14} colorValue={color} />
      )}
    </View>
  );
}

/** The label of the phase of a tool call, in the text color of the phase. */
export function ToolStatusLabel({
  phase,
  style,
}: {
  phase: ToolLifecyclePhase;
  style: StyleProp<TextStyle>;
}): ReactElement {
  const { desktop } = useAppTheme();
  const status = TOOL_STATUS[phase];
  return <Text style={[style, { color: status.textColor(desktop) }]}>{status.label}</Text>;
}

const styles = StyleSheet.create({
  // The first line of a command line is 18 points high, so the icon sits on its middle.
  icon: { width: 14, height: 18, alignItems: "center", justifyContent: "center" },
});
