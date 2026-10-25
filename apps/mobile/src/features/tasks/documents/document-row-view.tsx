import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownBlockView } from "@/rich-content/markdown/markdown-view";
import { useAppTheme } from "@/theme/app-theme-context";
import { Badge } from "@/ui/badge";
import { CollapseChevron } from "@/ui/collapse-chevron";
import { haptics } from "@/ui/haptics";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import type { DocumentRow } from "./document-rows";

/**
 * One row of the description card of the task details, as the desktop details cards: the
 * uppercase header with its help icon in the card, a state line, or a Markdown block. The header
 * opens and closes the card, and a closed card is its header alone. The description is part of
 * the task record, so it has no read to retry.
 */
export const DocumentRowView = memo(function DocumentRowView({
  row,
  collapsed,
  onToggle,
}: {
  row: DocumentRow;
  collapsed: boolean;
  onToggle: () => void;
}): ReactElement {
  const theme = useAppTheme();
  switch (row.kind) {
    case "doc_header":
      return (
        <View style={styles.column}>
          {/* The card top clips the highlight of the press to its rounded corners. */}
          <View style={collapsed ? styles.closedCardHeader : styles.cardHeader}>
            <Touchable
              feedback="highlight"
              onPress={() => {
                haptics.selection();
                onToggle();
              }}
              accessibilityRole="button"
              accessibilityLabel={row.title}
              accessibilityState={{ expanded: !collapsed }}
              style={[styles.cardHeaderPress, collapsed && styles.closedCardHeaderPress]}
            >
              <Icon name="circle-help" size={14} colorValue={theme.desktop.mutedForeground} />
              <Text
                variant="footnote"
                weight="semibold"
                overline
                numberOfLines={1}
                style={styles.cardTitle}
              >
                {row.title}
              </Text>
              {row.badge ? <Badge label={row.badge.label} tone={row.badge.tone} /> : null}
              <CollapseChevron collapsed={collapsed} colorValue={theme.desktop.mutedForeground} />
            </Touchable>
          </View>
        </View>
      );
    case "doc_state":
      return (
        <View style={styles.column}>
          <View style={styles.state}>
            <View style={styles.stateBox}>
              <Text
                variant="subhead"
                selectable={row.state === "error"}
                style={row.state === "error" ? styles.errorText : styles.mutedText}
              >
                {row.message}
              </Text>
            </View>
          </View>
        </View>
      );
    case "doc_block":
      return (
        <View style={styles.column}>
          <View
            style={[
              styles.block,
              row.first && styles.firstBlock,
              row.last && styles.lastBlock,
              !row.first && row.block.node.type === "heading" && styles.heading,
            ]}
          >
            <MarkdownBlockView
              block={row.block}
              definitions={row.definitions}
              imageContext={row.imageContext}
              selectable
            />
          </View>
        </View>
      );
  }
});

const styles = StyleSheet.create((theme) => ({
  column: { width: "100%", paddingHorizontal: theme.layout.screenPadding },
  state: {
    gap: theme.space.md,
    paddingHorizontal: theme.space.md,
    paddingBottom: theme.space.md,
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: theme.radius.lg,
    borderBottomRightRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  stateBox: {
    paddingHorizontal: theme.space.md,
    paddingVertical: 10,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.muted,
  },
  mutedText: { color: theme.desktop.mutedForeground },
  errorText: { color: theme.desktop.destructive },
  cardHeader: {
    overflow: "hidden",
    marginTop: theme.space.md,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  // A closed card is its header alone. It has its own whole style: Unistyles drops a radius that
  // a style array gains later.
  closedCardHeader: {
    overflow: "hidden",
    marginTop: theme.space.md,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  cardHeaderPress: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.sm,
  },
  // A closed card has the space of its top under the title.
  closedCardHeaderPress: { paddingBottom: theme.space.md },
  cardTitle: { flex: 1, color: theme.desktop.mutedForeground },
  block: {
    // Half the Markdown block gap on each side of a block.
    paddingVertical: theme.space.md / 2,
    // Rows can land on fractions of a pixel. The overlap keeps the background from showing
    // between two blocks of one card.
    marginBottom: -1,
    paddingHorizontal: theme.space.lg,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  // The card header above the first block draws the top of the card.
  firstBlock: { paddingTop: theme.space.xs },
  lastBlock: {
    marginBottom: 0,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomLeftRadius: theme.radius.lg,
    borderBottomRightRadius: theme.radius.lg,
    borderCurve: "continuous",
  },
  heading: { paddingTop: theme.space.lg },
}));
