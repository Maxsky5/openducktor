import { memo, type ReactElement, useCallback } from "react";
import {
  type AccessibilityActionEvent,
  ActivityIndicator,
  type DimensionValue,
  Platform,
  View,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { StatusLabel } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Icon } from "@/ui/icon";
import { IconButton } from "@/ui/icon-button";
import { TextPlaceholder } from "@/ui/placeholders";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import type { TerminalRow as TerminalRowModel } from "./terminal-list-model";

export type TerminalRowProps = {
  row: TerminalRowModel;
  /** The first row of its group draws no separator. */
  first: boolean;
  selected: boolean;
  /** True when a tap pushes the terminal, so iOS shows a chevron. */
  disclosure: boolean;
  /** The host guidance of a close with a lost result. */
  closeUnknownGuidance: string | null;
  /** Why a start cannot run now, so Retry waits too. */
  startBlockedReason: string | null;
  onOpen: (terminalId: string) => void;
  onClose: (tabId: string) => void;
  onRetry: (tabId: string) => void;
};

const TILE_SIZE = 32;

/**
 * One terminal of a task or chat, as a desktop terminal tab: the terminal icon, the label, and a
 * close control that turns into a spinner while the terminal closes. Under the label, the row
 * shows the state as a dot and a word, a running command, and who started the terminal and when. Screen
 * readers find Close in the actions of the row too.
 */
export const TerminalRow = memo(function TerminalRow({
  row,
  first,
  selected,
  disclosure,
  closeUnknownGuidance,
  startBlockedReason,
  onOpen,
  onClose,
  onRetry,
}: TerminalRowProps): ReactElement {
  const { terminalId } = row;
  const closable = !row.closing;
  styles.useVariants({ selected });
  const accessibilityLabel = [
    row.title,
    row.stateLabel,
    row.startedLabel,
    row.runsCommand ? "Running a command" : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
  const close = useCallback(() => onClose(row.tabId), [onClose, row.tabId]);
  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === "close") close();
    },
    [close],
  );
  const accessibilityActions = closable ? CLOSE_ACTIONS : NO_ACTIONS;
  return (
    <View style={styles.box}>
      {first ? null : <View style={styles.separator} />}
      <View style={styles.line}>
        {closable && terminalId !== null ? (
          <Touchable
            feedback="highlight"
            onPress={() => onOpen(terminalId)}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            accessibilityHint="Opens the terminal."
            accessibilityState={{ selected }}
            accessibilityActions={accessibilityActions}
            onAccessibilityAction={onAccessibilityAction}
            containerStyle={styles.main}
            style={styles.row}
          >
            <TerminalRowBody row={row} />
            {disclosure && Platform.OS === "ios" ? (
              <Icon name="chevron-right" size={14} color="quaternaryLabel" />
            ) : null}
          </Touchable>
        ) : (
          <View
            style={[styles.main, styles.row]}
            accessible
            accessibilityLabel={accessibilityLabel}
            accessibilityActions={accessibilityActions}
            onAccessibilityAction={onAccessibilityAction}
          >
            <TerminalRowBody row={row} />
          </View>
        )}
        <View style={styles.close}>
          <CloseControl row={row} onClose={close} />
        </View>
      </View>
      <TerminalRowExtras
        row={row}
        closeUnknownGuidance={closeUnknownGuidance}
        startBlockedReason={startBlockedReason}
        onRetry={onRetry}
      />
    </View>
  );
});

/**
 * A terminal row for the first load: the tile, bars in place of the title and the state, and the
 * space of the close control. It uses the row styles, so the loaded list takes its exact place.
 */
export function TerminalRowPlaceholder({
  first,
  titleWidth,
}: {
  first: boolean;
  titleWidth: DimensionValue;
}): ReactElement {
  styles.useVariants({ selected: false });
  return (
    <View style={styles.box}>
      {first ? null : <View style={styles.separator} />}
      <View style={styles.line}>
        <View style={[styles.main, styles.row]}>
          <View style={[styles.tile, styles.placeholderFill]} />
          <View style={styles.body}>
            <TextPlaceholder width={titleWidth} />
            <TextPlaceholder variant="footnote" width="38%" />
          </View>
        </View>
        <View style={styles.close}>
          <View style={styles.closing} />
        </View>
      </View>
    </View>
  );
}

/** The terminal icon, the label, the state, who started it and when, and a running command. */
function TerminalRowBody({ row }: { row: TerminalRowModel }): ReactElement {
  const theme = useAppTheme();
  return (
    <>
      <View style={styles.tile}>
        <Icon name="square-terminal" size={16} color="terminalForeground" />
      </View>
      <View style={styles.body}>
        <Text weight="medium" numberOfLines={1} ellipsizeMode="middle">
          {row.title}
        </Text>
        <View style={styles.status}>
          <StatusLabel
            label={row.stateLabel}
            tone={row.stateTone}
            pulse={row.stateTone === "running"}
          />
          {row.startedLabel ? (
            <Text variant="footnote" numberOfLines={1} style={styles.muted}>
              {row.startedLabel}
            </Text>
          ) : null}
        </View>
        {row.runsCommand ? (
          <View style={styles.command}>
            <Icon
              name="square-terminal"
              size={13}
              colorValue={theme.desktop.statusRunningForeground}
            />
            <Text variant="footnote" weight="medium" style={styles.commandText}>
              Running a command
            </Text>
          </View>
        ) : null}
      </View>
    </>
  );
}

/** The close control, which turns into a spinner while the terminal closes. */
function CloseControl({
  row,
  onClose,
}: {
  row: TerminalRowModel;
  onClose: () => void;
}): ReactElement {
  const theme = useAppTheme();
  if (row.closing) {
    return (
      <View
        style={styles.closing}
        accessibilityRole="progressbar"
        accessibilityLabel={`Closing ${row.title}`}
      >
        <ActivityIndicator size="small" color={theme.desktop.mutedForeground} />
      </View>
    );
  }
  return (
    <IconButton
      icon="x"
      size={18}
      color="secondaryLabel"
      command={row.terminalId !== null}
      accessibilityLabel={`Close ${row.title}`}
      onPress={onClose}
    />
  );
}

/** The detail or failure of a terminal, a lost start or close result, and Retry. */
function TerminalRowExtras({
  row,
  closeUnknownGuidance,
  startBlockedReason,
  onRetry,
}: Pick<
  TerminalRowProps,
  "row" | "closeUnknownGuidance" | "startBlockedReason" | "onRetry"
>): ReactElement | null {
  const showsDetail = row.detail !== null && !row.outcomeUnknown;
  if (!showsDetail && !row.outcomeUnknown && closeUnknownGuidance === null && !row.canRetry) {
    return null;
  }
  return (
    <View style={styles.extras}>
      {showsDetail ? (
        <Text
          variant="footnote"
          selectable
          style={row.detailIsFailure ? styles.failure : styles.muted}
        >
          {row.detail}
        </Text>
      ) : null}
      {row.outcomeUnknown ? (
        <Callout
          tone="warning"
          title="Result unknown"
          message={`${row.detail ?? "The host result of this start was lost."} The list shows the terminal if the host started it.`}
        />
      ) : null}
      {closeUnknownGuidance !== null ? (
        <Callout
          tone="warning"
          title="Result unknown"
          message={`The close result was lost. ${closeUnknownGuidance}`}
        />
      ) : null}
      {row.canRetry ? (
        <View style={styles.retry}>
          <Button
            label="Retry terminal creation"
            icon="rotate-ccw"
            size="sm"
            variant="outline"
            command
            disabled={startBlockedReason !== null}
            accessibilityLabel={`Retry the start of ${row.title}`}
            accessibilityHint={startBlockedReason ?? undefined}
            onPress={() => onRetry(row.tabId)}
          />
        </View>
      ) : null}
    </View>
  );
}

const CLOSE_ACTIONS = [{ name: "close", label: "Close Terminal" }];
const NO_ACTIONS: typeof CLOSE_ACTIONS = [];

const styles = StyleSheet.create((theme) => ({
  // The selected terminal of a wide screen, as the selected desktop tab: a muted wash.
  box: {
    variants: {
      selected: {
        true: { backgroundColor: theme.desktop.muted },
        false: {},
      },
    },
  },
  separator: {
    height: theme.hairline,
    marginLeft: theme.space.lg + TILE_SIZE + theme.space.md,
    backgroundColor: theme.desktop.border,
  },
  line: { flexDirection: "row", alignItems: "center" },
  main: { flex: 1, minWidth: 0 },
  row: {
    minHeight: Platform.select({ ios: 60, default: 68 }),
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingLeft: theme.space.lg,
    paddingRight: theme.space.xs,
    paddingVertical: theme.space.md,
  },
  // The tile uses the terminal surface in both themes, as the desktop terminal panel.
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: theme.radius.sm,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.terminalSurface,
  },
  body: { flex: 1, minWidth: 0, gap: 3 },
  status: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: theme.space.md,
    rowGap: 2,
  },
  muted: { color: theme.desktop.mutedForeground },
  failure: { color: theme.desktop.warningMuted },
  command: { flexDirection: "row", alignItems: "center", gap: 6 },
  commandText: { color: theme.desktop.infoMuted },
  close: { paddingRight: theme.space.xs },
  placeholderFill: { backgroundColor: theme.colors.fill },
  closing: {
    width: theme.touchTarget - 4,
    height: theme.touchTarget - 4,
    alignItems: "center",
    justifyContent: "center",
  },
  extras: {
    gap: theme.space.sm,
    paddingLeft: theme.space.lg + TILE_SIZE + theme.space.md,
    paddingRight: theme.space.lg,
    paddingBottom: theme.space.md,
  },
  retry: { alignItems: "flex-start" },
}));
