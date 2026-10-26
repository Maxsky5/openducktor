import type { InlineCommentOwner } from "@openducktor/frontend-core/drafts/inline-comment-owner";
import type { AgentChatPendingSendGroup } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import { useRouter } from "expo-router";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { usePendingCommentFocus } from "@/features/review/use-diff-comments";
import { routes, type WorkOwnerParams } from "@/navigation/routes";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";

/**
 * The pending review comments that go with the next message, as the desktop composer line, with
 * a View link to Changes and the warning of the comments. View opens the scope and the diff of
 * the first comment.
 */
export function PendingCommentsNotice({
  comments,
  workOwner,
  commentOwner,
}: {
  comments: AgentChatPendingSendGroup;
  /** The task or chat whose Changes hold the comments, or null when the session has none. */
  workOwner: WorkOwnerParams | null;
  /** The owner of the comment drafts. */
  commentOwner: InlineCommentOwner | null;
}): ReactElement {
  const router = useRouter();
  const theme = useAppTheme();
  const focus = usePendingCommentFocus(commentOwner);
  const { count, warning } = comments;
  // The desktop warning: `text-amber-700 dark:text-amber-300`.
  const warningColor = theme.scheme === "dark" ? theme.palette.amber300 : theme.palette.amber700;
  return (
    <View style={styles.pending} accessibilityRole="summary">
      <View style={styles.pendingLine}>
        <Icon name="message-square-diff" size={14} colorValue={theme.desktop.mutedForeground} />
        <Text
          variant="caption2"
          style={[styles.pendingText, styles.grow]}
          accessibilityLabel={comments.accessibleLabel}
        >
          {`${count} pending review ${count === 1 ? "comment goes" : "comments go"} with your next message`}
        </Text>
        {workOwner ? (
          <Touchable
            feedback="opacity"
            hitSlop={12}
            onPress={() => router.push(routes.changes(workOwner, focus ?? undefined))}
            accessibilityRole="button"
            accessibilityLabel="View pending review comments in Changes"
          >
            <Text variant="caption2" style={styles.pendingLink}>
              View
            </Text>
          </Touchable>
        ) : null}
      </View>
      {warning ? (
        <View style={styles.pendingLine} accessibilityRole="alert">
          <Icon name="triangle-alert" size={14} colorValue={warningColor} />
          <Text
            variant="caption2"
            style={[styles.pendingText, styles.grow, { color: warningColor }]}
          >
            {warning}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  grow: { flex: 1, minWidth: 0 },
  pending: { gap: theme.space.xs, paddingHorizontal: theme.space.md, paddingTop: 10 },
  pendingLine: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  pendingText: {
    fontFamily: theme.fonts.sans.regular,
    fontWeight: "400",
    fontSize: 11,
    lineHeight: 15,
    color: theme.desktop.mutedForeground,
  },
  pendingLink: {
    fontFamily: theme.fonts.sans.medium,
    fontWeight: "500",
    fontSize: 11,
    lineHeight: 15,
    color: theme.desktop.foreground,
    textDecorationLine: "underline",
  },
}));
