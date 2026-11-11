import { plural } from "@openducktor/frontend-core/lib/plural";
import { getToolDuration } from "@openducktor/frontend-core/sessions/messages/tool-duration";
import {
  getToolLifecyclePhase,
  type ToolLifecyclePhase,
} from "@openducktor/frontend-core/sessions/messages/tool-lifecycle";
import {
  countFailedCalls,
  type EarlierCalls,
  readEarlierCalls,
  readEarlierCallStep,
  readHideEarlierCallsLabel,
  readShowEarlierCallsLabel,
  readToolRunCallLine,
  readToolRunCountLabels,
  readToolRunStates,
  readToolRunTitle,
  type ToolRunCallLine,
  type ToolRunRow,
  type ToolRunState,
  type ToolRunTitle,
} from "@openducktor/frontend-core/sessions/transcript/tool-runs";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import type { AppTheme } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui/icon";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { monoWeight, sansWeight } from "@/theme/tokens";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import type { ToolRunListItem } from "../transcript-list-items";
import { useTranscriptRows } from "../transcript-rows-context";
import { messageTimeLabel } from "../transcript-text";
import { useDisclosure, useKeptHiddenCalls } from "./disclosure";
import { DisclosureMarker, ToolTiming } from "./row-parts";
import { toolIcon } from "./tool-icon";
import { TOOL_STATUS } from "./tool-status-presentation";

/**
 * A run of consecutive tool run calls, as on desktop: shell commands, file lookups and edits, web
 * searches, and the calls of tools that show one line. Each run, also a run of one call, gets a
 * header line that folds it, so nothing moves when the next call comes. The calls show under it
 * along a guide line, each as one line with the icon of its tool in the color of its status. A
 * long run shows its latest calls under a line that shows the others.
 */

const TITLE_ICONS = {
  Shell: "square-terminal",
  Files: "file-search",
  Web: "globe",
  Tools: "wrench",
} as const satisfies Record<ToolRunTitle, IconName>;

export const ToolRunListRow = memo(function ToolRunListRow({
  item,
}: {
  item: ToolRunListItem;
}): ReactElement {
  const { desktop } = useAppTheme();
  const disclosure = useDisclosure(true, `${item.runKey}:tool-run`);
  const [keptHidden, chooseKeptHidden] = useKeptHiddenCalls(`${item.runKey}:kept-hidden`);
  const countLabels = readToolRunCountLabels(item);
  const title = readToolRunTitle(item);
  const earlier = readEarlierCalls(item.rows.length, keptHidden);
  const states = readToolRunStates(item, !disclosure.open);
  return (
    <View style={styles.run}>
      <Touchable
        feedback="highlight"
        radius={8}
        onPress={() => {
          // A long run shows its latest calls again when the reader opens it again.
          if (disclosure.open) chooseKeptHidden(undefined);
          disclosure.toggle();
        }}
        accessibilityRole="button"
        accessibilityLabel={[title, ...countLabels, ...states.map((state) => state.label)].join(
          ", ",
        )}
        accessibilityState={{ expanded: disclosure.open }}
        style={styles.header}
      >
        <Icon name={TITLE_ICONS[title]} size={14} colorValue={desktop.mutedForeground} />
        <Text style={[styles.headerTitle, { color: desktop.foreground }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.headerMeta, { color: desktop.mutedForeground }]}>
          {countLabels.join(" · ")}
        </Text>
        <DisclosureMarker
          open={disclosure.open}
          animated={disclosure.pressed}
          color={desktop.mutedForeground}
        />
        <Text numberOfLines={1} style={styles.headerStates}>
          {states.map((state, index) => (
            <Text
              key={state.key}
              style={[styles.headerState, { color: stateColor(state.key, desktop) }]}
            >
              {index > 0 ? " · " : ""}
              {state.label}
            </Text>
          ))}
        </Text>
      </Touchable>
      {disclosure.open ? (
        // The guide line runs under the kind icon of the header, and the calls start under its
        // label.
        <View style={[styles.nested, { borderLeftColor: desktop.border }]}>
          <EarlierCallsBar item={item} earlier={earlier} onChoose={chooseKeptHidden} />
          {item.rows.slice(earlier.earlierCallCount).map((row) => (
            <ToolRunLine key={row.key} row={row} />
          ))}
        </View>
      ) : null}
    </View>
  );
});

/**
 * The line at the top of a long open run. It shows the earlier calls that the run hides, a page
 * at a time, with the failed calls among them. After the reader showed some, it also hides them
 * again. A run of six calls or fewer has no such line.
 */
function EarlierCallsBar({
  item,
  earlier: { earlierCallCount, shownEarlierCount },
  onChoose,
}: {
  item: ToolRunListItem;
  earlier: EarlierCalls;
  onChoose: (keptHidden: number | undefined) => void;
}): ReactElement | null {
  const { desktop } = useAppTheme();
  if (earlierCallCount === 0 && shownEarlierCount === 0) return null;
  const failedCount = countFailedCalls(item.rows.slice(0, earlierCallCount));
  return (
    <View style={styles.earlierBar}>
      {earlierCallCount > 0 ? (
        <Touchable
          feedback="highlight"
          radius={8}
          onPress={() => onChoose(earlierCallCount - readEarlierCallStep(earlierCallCount))}
          accessibilityRole="button"
          style={[styles.earlier, styles.earlierShow]}
        >
          <Icon name="chevrons-up" size={14} colorValue={desktop.mutedForeground} />
          <Text numberOfLines={1} style={styles.earlierLabel}>
            <Text style={{ color: desktop.mutedForeground }}>
              {readShowEarlierCallsLabel(earlierCallCount)}
            </Text>
            {failedCount > 0 ? (
              <Text style={{ color: desktop.destructiveMuted }}>
                {" · "}
                {failedCount} failed
              </Text>
            ) : null}
          </Text>
        </Touchable>
      ) : null}
      {shownEarlierCount > 0 ? (
        <Touchable
          feedback="highlight"
          radius={8}
          onPress={() => onChoose(undefined)}
          accessibilityRole="button"
          style={styles.earlier}
        >
          <Icon name="chevrons-down-up" size={14} colorValue={desktop.mutedForeground} />
          <Text numberOfLines={1} style={[styles.earlierLabel, { color: desktop.mutedForeground }]}>
            {earlierCallCount > 0 ? "Hide" : readHideEarlierCallsLabel(shownEarlierCount)}
          </Text>
        </Touchable>
      ) : null}
    </View>
  );
}

/** The color of a state of a run in its header, as on desktop. */
const stateColor = (key: ToolRunState["key"], desktop: AppTheme["desktop"]): string => {
  if (key === "failed") return desktop.destructiveMuted;
  if (key === "cancelled") return desktop.cancelledMuted;
  return desktop.statusRunningForeground;
};

/**
 * The color of the icon of a call by status, as on desktop. A call that succeeded keeps the color
 * of the other tool icons, so only running, failed, and cancelled calls stand out.
 */
const statusColor = (phase: ToolLifecyclePhase, desktop: AppTheme["desktop"]): string => {
  if (phase === "failed") return desktop.destructiveMuted;
  if (phase === "cancelled") return desktop.cancelledMuted;
  if (phase === "executing") return desktop.statusRunningForeground;
  return desktop.mutedForeground;
};

/**
 * The icon of a call, as on desktop: the icon of its tool in the color of its status. A spinner
 * takes its place while the agent writes the call and while the call runs.
 */
function ToolCallIcon({
  meta,
  phase,
}: {
  meta: ToolRunRow["message"]["meta"];
  phase: ToolLifecyclePhase;
}): ReactElement {
  const { desktop } = useAppTheme();
  const color = statusColor(phase, desktop);
  if (phase === "executing" || phase === "preparing") {
    return (
      <View style={styles.callIcon}>
        <LoaderSpinner size={12} color={color} />
      </View>
    );
  }
  return <Icon name={toolIcon(meta)} size={14} colorValue={color} />;
}

/**
 * One call of a tool run: its status, its command or its tool and summary, the first line of its
 * error, and its timing. A press opens the call in the tool details sheet. The line renders again
 * only when its row changes.
 */
const ToolRunLine = memo(function ToolRunLine({ row }: { row: ToolRunRow }): ReactElement {
  const { desktop } = useAppTheme();
  const { openFullView, presentToolCall, workingDirectory } = useTranscriptRows();
  const { message } = row;
  const { meta } = message;
  const phase = getToolLifecyclePhase(meta);
  const line = readToolRunCallLine(row, presentToolCall, workingDirectory);
  const { errorPreview } = line;
  // The desktop line reads its status, its call, and its error preview.
  const accessibilityLabel = [TOOL_STATUS[phase].label, readLineLabel(line), errorPreview || null]
    .filter((part) => part !== null)
    .join(", ");
  const changes = line.kind === "call" ? line.changes : null;
  return (
    <Touchable
      feedback="highlight"
      radius={8}
      onPress={() =>
        openFullView({
          kind: "tool",
          messageId: message.id,
          title: line.kind === "command" ? line.title : line.toolName,
        })
      }
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={readLineHint(line)}
      style={styles.line}
    >
      {/* The icon of the tool, in the color of the status of the call. */}
      <ToolCallIcon meta={meta} phase={phase} />
      <View style={styles.lineText}>
        {line.kind === "command" ? (
          <CommandLineText line={line} />
        ) : (
          <ToolCallLineText line={line} />
        )}
        {errorPreview ? (
          <Text
            numberOfLines={1}
            style={[styles.errorPreview, { color: desktop.destructiveMuted }]}
          >
            {errorPreview}
          </Text>
        ) : null}
      </View>
      {changes && (changes.additions > 0 || changes.deletions > 0) ? (
        <Text style={styles.changes}>
          {changes.additions > 0 ? (
            <Text style={{ color: desktop.successMuted }}>+{changes.additions} </Text>
          ) : null}
          {changes.deletions > 0 ? (
            <Text style={{ color: desktop.destructiveMuted }}>-{changes.deletions}</Text>
          ) : null}
        </Text>
      ) : null}
      {phase === "cancelled" ? (
        <Text style={[styles.cancelled, { color: desktop.mutedForeground }]}>Cancelled</Text>
      ) : null}
      <ToolTiming
        active={false}
        durationMs={getToolDuration(meta, message.timestamp)}
        timeLabel={messageTimeLabel(message)}
      />
    </Touchable>
  );
});

type CommandLine = Extract<ToolRunCallLine, { kind: "command" }>;
type CallLine = Extract<ToolRunCallLine, { kind: "call" }>;

/** What a screen reader reads of a line: the tool, and the command or the summary of the call. */
const readLineLabel = (line: ToolRunCallLine): string => {
  if (line.kind === "call") return `${line.name} ${line.summary}`.trim();
  const more = line.extraLineCount > 0 ? `, ${plural(line.extraLineCount, "more line")}` : "";
  return `${line.name} ${line.text}${more}`;
};

const readLineHint = (line: ToolRunCallLine): string => {
  if (line.kind === "command") return "Shows the command and its output.";
  return line.changes ? "Shows the changes." : "Shows the call.";
};

/** The name of the tool and the first line of a command. A call that did not run shows dim. */
function CommandLineText({
  line: { name, text, isPreparing, isMuted, extraLineCount },
}: {
  line: CommandLine;
}): ReactElement {
  const { desktop } = useAppTheme();
  return (
    <View style={styles.commandLine}>
      <Text style={[styles.toolName, { color: desktop.mutedForeground }]}>{name}</Text>
      <Text
        numberOfLines={1}
        style={[
          styles.command,
          { color: isMuted || isPreparing ? desktop.mutedForeground : desktop.foreground },
        ]}
      >
        {text}
      </Text>
      {extraLineCount > 0 ? (
        <Text style={[styles.extraLines, { color: desktop.mutedForeground }]}>
          +{plural(extraLineCount, "line")}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The tool name and the summary of a call: the path or the pattern of a file lookup, which shows
 * in the font of code, the query of a web search, or the input of a tool call.
 */
function ToolCallLineText({
  line: { name, summary, isPath, isMuted },
}: {
  line: CallLine;
}): ReactElement {
  const { desktop } = useAppTheme();
  return (
    <View style={styles.commandLine}>
      <Text style={[styles.toolName, { color: desktop.mutedForeground }]}>{name}</Text>
      <Text
        numberOfLines={1}
        ellipsizeMode={isPath ? "middle" : "tail"}
        style={[
          isPath ? styles.command : styles.summary,
          { color: isMuted ? desktop.mutedForeground : desktop.foreground },
        ]}
      >
        {summary}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  callIcon: { width: 14, height: 14, alignItems: "center", justifyContent: "center" },
  run: { paddingVertical: 2 },
  // The tool line padding, then the 14-point icon and the gap of the header before the calls.
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: 32,
    paddingHorizontal: theme.space.xs,
  },
  headerTitle: { ...sansWeight("medium"), fontSize: 13, lineHeight: 18, flexShrink: 0 },
  headerMeta: { ...sansWeight("regular"), fontSize: 13, lineHeight: 18, flexShrink: 1 },
  headerStates: { marginLeft: "auto", flexShrink: 0 },
  headerState: { ...sansWeight("regular"), fontSize: 12, lineHeight: 16 },
  earlierBar: { flexDirection: "row", alignItems: "center" },
  earlierShow: { flex: 1, minWidth: 0 },
  earlier: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: 32,
    paddingHorizontal: theme.space.xs,
  },
  earlierLabel: { ...sansWeight("regular"), fontSize: 12.5, lineHeight: 18, flexShrink: 1 },
  nested: {
    marginLeft: theme.space.xs + 6.5,
    paddingLeft: 14 + theme.space.sm - 7.5 - theme.space.xs,
    borderLeftWidth: 1,
  },
  line: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.sm,
    minHeight: 32,
    paddingHorizontal: theme.space.xs,
    paddingVertical: 7,
  },
  lineText: { flex: 1, minWidth: 0, gap: 2 },
  commandLine: { flexDirection: "row", alignItems: "baseline", gap: theme.space.sm },
  toolName: { ...sansWeight("medium"), fontSize: 12.5, lineHeight: 18, flexShrink: 0 },
  command: { ...monoWeight("regular"), fontSize: 12.5, lineHeight: 18, flexShrink: 1 },
  summary: { ...sansWeight("regular"), fontSize: 13, lineHeight: 18, flexShrink: 1 },
  extraLines: { ...sansWeight("regular"), fontSize: 11.5, lineHeight: 16, flexShrink: 0 },
  errorPreview: { ...sansWeight("regular"), fontSize: 12, lineHeight: 16 },
  cancelled: { ...sansWeight("regular"), fontSize: 11.5, lineHeight: 18, flexShrink: 0 },
  changes: { ...monoWeight("regular"), fontSize: 11.5, lineHeight: 18, flexShrink: 0 },
}));
