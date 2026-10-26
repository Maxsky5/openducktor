import type { InlineCommentDraft } from "@openducktor/frontend-core/drafts/inline-comment-draft-store";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { PIERRE_COLORS } from "@/rich-content/diff/pierre-colors";
import { useAppTheme } from "@/theme/app-theme-context";
import { Badge } from "@/ui/badge";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";

const lineRangeLabel = (comment: InlineCommentDraft): string => {
  const side = comment.side === "old" ? "removed" : "new";
  return comment.startLine === comment.endLine
    ? `Line ${comment.startLine}, ${side}`
    : `Lines ${comment.startLine}-${comment.endLine}, ${side}`;
};

/**
 * A pending Inline Diff Comment, as the desktop draft comment card: a Pending badge, the line
 * range, the text, and the Edit and Remove controls. It sits in the diff under its last line.
 */
export const DiffCommentView = memo(function DiffCommentView({
  comment,
  onEdit,
  onRemove,
}: {
  comment: InlineCommentDraft;
  onEdit: (comment: InlineCommentDraft) => void;
  onRemove: (comment: InlineCommentDraft) => void;
}): ReactElement {
  const theme = useAppTheme();
  const sending = comment.status === "submitting";
  const range = lineRangeLabel(comment);
  return (
    <View style={styles.row}>
      <View style={styles.card}>
        <View style={styles.meta}>
          <Badge label="Pending" tone="warning" />
          {sending ? <Badge label="Sending" /> : null}
          <Text variant="caption1" numberOfLines={1} style={styles.range}>
            {range}
          </Text>
        </View>
        <Text variant="subhead" selectable style={styles.text}>
          {comment.text}
        </Text>
        <View style={styles.actions}>
          <Touchable
            feedback="scale"
            onPress={() => onEdit(comment)}
            disabled={sending}
            radius={theme.radius.md}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Edit the comment on ${range}`}
            style={styles.edit}
          >
            <Icon name="pencil" size={16} colorValue={theme.desktop.foreground} />
          </Touchable>
          <Touchable
            feedback="scale"
            onPress={() => onRemove(comment)}
            disabled={sending}
            radius={theme.radius.md}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Remove the comment on ${range}`}
            style={styles.remove}
          >
            <Icon name="trash-2" size={16} colorValue={theme.desktop.destructiveForeground} />
          </Touchable>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
    backgroundColor: PIERRE_COLORS[theme.scheme].background,
  },
  card: {
    gap: theme.space.md,
    padding: theme.space.md,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  meta: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  range: { flex: 1, color: theme.desktop.mutedForeground },
  text: { color: theme.desktop.foreground },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.space.sm },
  edit: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  remove: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.desktop.destructive,
  },
}));
