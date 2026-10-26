import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon, type IconName } from "@/ui/icon";
import { TextPlaceholder } from "@/ui/placeholders";
import { Text } from "@/ui/text";
import { CHAT_SECTION_LABELS, type ChatSectionId } from "./chat-sections";

const SECTION_ICONS = {
  today: "clock",
  yesterday: "history",
  earlier: "calendar",
} as const satisfies Record<ChatSectionId, IconName>;

/** The label of a group card, as the desktop agent activity groups: icon, name, and count. */
export const ChatSectionHeader = memo(function ChatSectionHeader({
  sectionId,
  count,
  first,
}: {
  sectionId: ChatSectionId;
  count: number;
  /** True for the first item of the list, which needs less space above it. */
  first: boolean;
}): ReactElement {
  const theme = useAppTheme();
  const label = CHAT_SECTION_LABELS[sectionId];
  return (
    <View
      style={[styles.header, first && styles.headerFirst]}
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${label}, ${count} ${count === 1 ? "chat" : "chats"}`}
    >
      <Icon name={SECTION_ICONS[sectionId]} size={14} colorValue={theme.colors.tertiaryLabel} />
      <Text variant="caption2" overline style={[styles.label, styles.accent]}>
        {label}
      </Text>
      <View style={styles.count}>
        <Text variant="caption2" tabular style={styles.accent}>
          {count}
        </Text>
      </View>
    </View>
  );
});

/** A group label for a first load: placeholders in place of the icon, the name, and the count. */
export function ChatSectionHeaderPlaceholder({ first }: { first: boolean }): ReactElement {
  return (
    <View style={[styles.header, first && styles.headerFirst]}>
      <View style={styles.placeholderIcon} />
      <TextPlaceholder variant="caption2" width={52} style={styles.label} />
      <View style={[styles.count, styles.placeholderCount]} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.layout.screenPadding + 4,
    paddingTop: theme.space.xxl,
    paddingBottom: theme.space.sm,
  },
  headerFirst: { paddingTop: theme.space.sm },
  label: { flex: 1 },
  accent: { color: theme.colors.tertiaryLabel },
  placeholderIcon: { width: 14, height: 14, borderRadius: 4, backgroundColor: theme.colors.fill },
  placeholderCount: { borderColor: theme.colors.fill, backgroundColor: theme.colors.fill },
  // The pill grows with the text size, so a large font does not clip the count.
  count: {
    minWidth: 24,
    minHeight: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.tones.neutral.border,
    backgroundColor: theme.tones.neutral.surface,
    alignItems: "center",
    justifyContent: "center",
  },
}));
