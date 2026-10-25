import type { ReactElement } from "react";
import { Platform, useWindowDimensions, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { sansWeight } from "@/theme/tokens";
import { titleMaxWidth } from "./session-header-width";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";

/**
 * The title in the navigation bar in the desktop `text-sm font-semibold`, with the open icon of a
 * task. The workflow rail under the bar shows the role and the state of the session.
 */
export function SessionHeaderTitle({
  title,
  maxWidth,
  accessibilityLabel,
  linked,
  onPress,
}: {
  title: string;
  maxWidth: number;
  accessibilityLabel: string;
  /** A task session title opens its task, so it shows the open icon. */
  linked: boolean;
  /** Opens the task details, or undefined until the screen can open them. */
  onPress: (() => void) | undefined;
}): ReactElement {
  const theme = useAppTheme();
  const content = (
    <View style={styles.titleLine}>
      <Text numberOfLines={1} style={[styles.titleText, styles.title]}>
        {title}
      </Text>
      {linked ? (
        <Icon
          name="square-arrow-out-up-right"
          size={12}
          colorValue={theme.desktop.mutedForeground}
        />
      ) : null}
    </View>
  );
  if (!onPress) {
    return (
      <View
        accessible
        accessibilityRole="header"
        accessibilityLabel={accessibilityLabel}
        style={[styles.titleBlock, { maxWidth }]}
      >
        {content}
      </View>
    );
  }
  return (
    <Touchable
      feedback="opacity"
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens the task details."
      style={[styles.titleBlock, { maxWidth }]}
    >
      {content}
    </Touchable>
  );
}

// A task session shows the task sessions, quick actions, and session menus; a chat its menu.
const TASK_SESSION_ACTIONS = 3;
const CHAT_ACTIONS = 1;

/** The session title that a route passed, before the session screen sets its header. */
export function RouteSessionTitle({ title, task }: { title: string; task: boolean }): ReactElement {
  const { width } = useWindowDimensions();
  return (
    <SessionHeaderTitle
      title={title}
      maxWidth={titleMaxWidth(width, task ? TASK_SESSION_ACTIONS : CHAT_ACTIONS)}
      accessibilityLabel={title}
      linked={task}
      onPress={undefined}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  titleBlock: {
    minHeight: theme.touchTarget,
    justifyContent: "center",
    alignItems: Platform.select({ ios: "center", default: "flex-start" }),
  },
  titleLine: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "100%" },
  titleText: { flexShrink: 1 },
  title: {
    ...sansWeight("semibold"),
    fontSize: 15,
    lineHeight: 20,
    color: theme.desktop.foreground,
  },
}));
