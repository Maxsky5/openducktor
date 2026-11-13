import { plural } from "@openducktor/frontend-core/lib/plural";
import { ToolFileEdits, ToolOutput, ToolPartSessionProvider } from "./tool-details";
import { formatRawJsonLikeText } from "@openducktor/frontend-core/sessions/messages/message-formatting";
import {
  formatToolInput,
  hasFileEditChanges,
  readToolDetailAvailability,
  readToolDetailsHeading,
  readToolDetailsError,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import {
  countTextLines,
  isShellCommandCall,
  EMPTY_SHELL_OUTPUT,
  readEmptyShellOutput,
  readCommandFolderLabel,
  readShellCommandOutput,
  readShellCommandCall,
} from "@openducktor/frontend-core/sessions/messages/shell-command-call";
import {
  parseTerminalText,
  readTerminalText,
  TERMINAL_TONE_COLORS,
  terminalColorValue,
} from "@openducktor/frontend-core/sessions/messages/terminal-text";
import { getToolDuration } from "@openducktor/frontend-core/sessions/messages/tool-duration";
import {
  getToolLifecyclePhase,
  type ToolLifecyclePhase,
} from "@openducktor/frontend-core/sessions/messages/tool-lifecycle";
import { useToolPartDetails } from "@openducktor/frontend-core/sessions/messages/use-tool-part-details";
import { formatAgentDuration } from "@openducktor/frontend-core/sessions/transcript/format-agent-duration";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import { type ComponentRef, type ReactElement, type ReactNode, useMemo, useRef } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MarkdownView } from "@/rich-content/markdown/markdown-view";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { monoWeight, sansWeight } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useTranscriptRows } from "../transcript-rows-context";
import { messageTimeLabel, truncateForDisplay } from "../transcript-text";
import { CopyControl, PreText } from "./row-parts";
import { ToolStatusIcon, ToolStatusLabel } from "./tool-status";

/**
 * The desktop tool details panel, in a sheet over the transcript: the status, timing, and the
 * command and output of a shell command, or the input, output, and error of another call. The
 * sheet follows the live message, so a running command shows its output as the runtime sends it.
 * The sheet does not scroll its content: each part scrolls by itself, as on desktop.
 */
export function ToolDetailsSheetContent({
  message,
  meta,
}: {
  message: AgentChatMessage;
  meta: ToolMeta;
}): ReactElement {
  const timing = { messageTimestamp: message.timestamp, timeLabel: messageTimeLabel(message) };
  return (
    <WithFullDetails meta={meta}>
      {(shown) => <ShownToolDetails meta={shown} {...timing} />}
    </WithFullDetails>
  );
}

type DetailsTiming = { messageTimestamp: string; timeLabel: string };

/** The details of a call by its kind: a shell command, a file edit, or another call. */
function ShownToolDetails({ meta, ...timing }: { meta: ToolMeta } & DetailsTiming): ReactElement {
  const { workingDirectory } = useTranscriptRows();
  if (isShellCommandCall(meta)) return <ShellCommandDetails meta={meta} {...timing} />;
  if (meta.toolType === "file_edit" && hasFileEditChanges(meta, workingDirectory)) {
    return <FileEditDetails meta={meta} {...timing} />;
  }
  return <ToolCallDetails meta={meta} {...timing} />;
}

/** The call with its full details. Compact history can cut them, so the sheet reads them first. */
function WithFullDetails({
  meta,
  children,
}: {
  meta: ToolMeta;
  children: (shown: ToolMeta) => ReactNode;
}): ReactNode {
  if (!meta.detailsOmitted) return children(meta);
  return (
    <ToolPartSessionProvider>
      <FullDetails meta={meta}>{children}</FullDetails>
    </ToolPartSessionProvider>
  );
}

function FullDetails({
  meta,
  children,
}: {
  meta: ToolMeta;
  children: (shown: ToolMeta) => ReactNode;
}): ReactNode {
  const { desktop } = useAppTheme();
  const { meta: full, error, retry } = useToolPartDetails(meta, true);
  if (!full.detailsOmitted) return children(full);
  if (error === null) {
    return (
      <View style={styles.loading} accessible accessibilityLabel="Loading the full details">
        <LoaderSpinner size={12} color={desktop.mutedForeground} />
        <Text style={[styles.meta, { color: desktop.mutedForeground }]}>
          Loading the full details…
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.loading}>
      <Text selectable style={[styles.meta, styles.fill, { color: desktop.destructive }]}>
        {error}
      </Text>
      <Touchable
        feedback="opacity"
        onPress={retry}
        accessibilityRole="button"
        accessibilityLabel="Retry loading the full details"
      >
        <Text style={[styles.meta, styles.retry, { color: desktop.foreground }]}>Retry</Text>
      </Touchable>
    </View>
  );
}

/** The status, run time, clock time, and exit code of a call, on one line. */
function StatusLine({
  meta,
  messageTimestamp,
  timeLabel,
  exitCode,
  timeoutMs,
  lineCount = 0,
}: {
  meta: ToolMeta;
  exitCode: number | null;
  timeoutMs: number | null;
  lineCount?: number;
} & DetailsTiming): ReactElement {
  const { desktop } = useAppTheme();
  const phase = getToolLifecyclePhase(meta);
  const durationMs = getToolDuration(meta, messageTimestamp);
  const facts = [
    durationMs === null ? null : formatAgentDuration(durationMs),
    timeLabel || null,
    timeoutMs === null ? null : `Timeout ${formatAgentDuration(timeoutMs)}`,
    lineCount > 0 ? plural(lineCount, "line") : null,
  ].filter((fact) => fact !== null);
  const failedExit = exitCode !== null && exitCode !== 0 ? exitCode : null;
  return (
    <View style={styles.statusLine}>
      <ToolStatusIcon phase={phase} decorative />
      <ToolStatusLabel phase={phase} style={styles.status} />
      {failedExit === null ? null : (
        <Text
          style={[
            styles.exitChip,
            {
              color: desktop.destructiveSurfaceForeground,
              backgroundColor: desktop.destructiveSurface,
            },
          ]}
        >
          exit {failedExit}
        </Text>
      )}
      {facts.map((fact) => (
        <Text key={fact} style={[styles.meta, { color: desktop.mutedForeground }]}>
          · {fact}
        </Text>
      ))}
    </View>
  );
}

/**
 * The details of a shell command call, as on desktop: its status and run facts, the command with
 * its folder, then its output with the colors that the command wrote. The sheet title names the
 * program of the command.
 */
function ShellCommandDetails({
  meta,
  messageTimestamp,
  timeLabel,
}: { meta: ToolMeta } & DetailsTiming): ReactElement {
  const phase = getToolLifecyclePhase(meta);
  const { text, error, message } = readShellCommandOutput(meta);
  return (
    <View style={styles.fillHeight}>
      <CommandSummary meta={meta} messageTimestamp={messageTimestamp} timeLabel={timeLabel} />
      <OutputBar text={text} />
      <CommandOutput text={text} error={error} message={message} phase={phase} />
    </View>
  );
}

/** The status and run facts of a command, its description, the command, and its folder. */
function CommandSummary({
  meta,
  messageTimestamp,
  timeLabel,
}: { meta: ToolMeta } & DetailsTiming): ReactElement {
  const { desktop } = useAppTheme();
  const { workingDirectory } = useTranscriptRows();
  const call = readShellCommandCall(meta);
  const folder = readCommandFolderLabel(call, workingDirectory);
  return (
    <ScrollView style={styles.commandArea} contentContainerStyle={styles.summary}>
      <StatusLine
        meta={meta}
        messageTimestamp={messageTimestamp}
        timeLabel={timeLabel}
        exitCode={call.exitCode}
        timeoutMs={call.timeoutMs}
      />
      {call.description ? (
        <Text style={[styles.description, { color: desktop.mutedForeground }]}>
          {call.description}
        </Text>
      ) : null}
      <View style={styles.sectionLabel}>
        <Text style={[styles.outputTitle, styles.fill, { color: desktop.foreground }]}>
          Command
        </Text>
        {call.command ? (
          <CopyControl
            text={call.command}
            what="Command"
            accessibilityLabel="Copy command"
            color={desktop.mutedForeground}
          />
        ) : null}
      </View>
      {/* The command is the input of the call: a filled block after a prompt. */}
      <View
        style={[
          styles.commandBlock,
          { backgroundColor: desktop.terminalPanel, borderColor: desktop.terminalBorder },
        ]}
      >
        <Text style={[styles.commandText, { color: TERMINAL_TONE_COLORS.green[0] }]}>$</Text>
        <Text
          selectable
          style={[styles.commandText, styles.fill, { color: desktop.terminalForeground }]}
        >
          {call.shownCommand || EMPTY_SHELL_OUTPUT.preparing}
        </Text>
      </View>
      {folder ? (
        <View style={styles.cwd} accessibilityLabel={`Folder ${folder}`}>
          <Icon name="folder" size={12} colorValue={desktop.mutedForeground} />
          <Text
            numberOfLines={1}
            ellipsizeMode="head"
            style={[styles.mono, styles.small, styles.fill, { color: desktop.mutedForeground }]}
          >
            {folder}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

/** The title row of the output, with its line count and its copy action. */
function OutputBar({ text }: { text: string }): ReactElement {
  const { desktop } = useAppTheme();
  const plainOutput = useMemo(() => readTerminalText(text), [text]);
  const lineCount = plainOutput ? countTextLines(plainOutput) : 0;
  return (
    <View style={styles.outputBar}>
      <Text style={[styles.outputTitle, { color: desktop.foreground }]}>Output</Text>
      <Text style={[styles.small, styles.fill, { color: desktop.mutedForeground }]}>
        {lineCount > 0 ? plural(lineCount, "line") : ""}
      </Text>
      {plainOutput ? (
        <CopyControl
          text={plainOutput}
          what="Output"
          accessibilityLabel="Copy output"
          color={desktop.mutedForeground}
        />
      ) : null}
    </View>
  );
}

/** The space under the end of the output that still counts as reading the end. */
const OUTPUT_END_THRESHOLD = 24;

/** Command output with the colors and styles that the command wrote. Long output keeps its end. */
function OutputText({ text }: { text: string }): ReactElement {
  const { desktop } = useAppTheme();
  // The output shows on the surface of the integrated terminal, so it takes the terminal colors.
  const shown = useMemo(() => {
    const cut = truncateForDisplay(text, undefined, "end");
    // A cut can start inside a line or an escape sequence, so the text starts at the next line.
    const start = cut.truncated ? cut.text.indexOf("\n") + 1 : 0;
    const segments = parseTerminalText(cut.text.slice(start)).map((segment, place) => ({
      segment,
      key: `run-${place}`,
    }));
    return { segments, notice: cut.notice };
  }, [text]);
  return (
    <>
      {shown.notice ? (
        <Text style={[styles.small, { color: desktop.terminalMuted }]}>{shown.notice}</Text>
      ) : null}
      <Text selectable style={[styles.outputText, { color: desktop.terminalForeground }]}>
        {shown.segments.map(({ segment, key }) => {
          const color = segment.fg ? terminalColorValue(segment.fg) : desktop.terminalForeground;
          // Each run sets its font and its color, because the shared text gives each run its own
          // defaults. A nested run has no opacity, so a dim run takes a dimmer color.
          return (
            <Text
              key={key}
              style={[
                styles.outputText,
                { color: segment.dim ? withAlpha(color, 0.6) : color },
                segment.bg ? { backgroundColor: terminalColorValue(segment.bg) } : null,
                segment.bold ? styles.outputBold : null,
                segment.italic ? styles.outputItalic : null,
                segment.underline ? styles.outputUnderline : null,
              ]}
            >
              {segment.text}
            </Text>
          );
        })}
      </Text>
    </>
  );
}

/**
 * The output of a command. It opens at its end, where commands print their result and their
 * errors. While the reader stays at the end, new output and a full output that replaces the
 * running output keep the end in view. A call that did not run shows its message for the agent.
 */
function CommandOutput({
  text,
  error,
  message,
  phase,
}: {
  text: string;
  /** The error of a failed command that also gave output. */
  error: string;
  message: string;
  phase: ToolLifecyclePhase;
}): ReactElement {
  const { desktop } = useAppTheme();
  const { supportsRunningCommandOutput } = useTranscriptRows();
  // Only a runtime that sends the output of a running command gives live output.
  const follow = phase === "executing" && supportsRunningCommandOutput;
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const isAtEndRef = useRef(true);
  return (
    <ScrollView
      ref={scrollRef}
      accessibilityLabel="Command output"
      style={[
        styles.outputBlock,
        { backgroundColor: desktop.terminalPanel, borderColor: desktop.terminalBorder },
      ]}
      contentContainerStyle={styles.outputContent}
      scrollEventThrottle={100}
      onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        isAtEndRef.current =
          contentSize.height - contentOffset.y - layoutMeasurement.height <= OUTPUT_END_THRESHOLD;
      }}
      onContentSizeChange={() => {
        if (isAtEndRef.current) scrollRef.current?.scrollToEnd({ animated: false });
      }}
    >
      {follow ? (
        <View style={styles.live}>
          <View style={[styles.liveDot, { backgroundColor: desktop.statusRunningForeground }]} />
          <Text style={[styles.small, { color: desktop.statusRunningForeground }]}>Live</Text>
        </View>
      ) : null}
      {error ? (
        <Text style={[styles.outputText, { color: TERMINAL_TONE_COLORS.red[1] }]}>
          {readTerminalText(error)}
        </Text>
      ) : null}
      {message ? (
        <View accessibilityLabel="Message to the agent" style={styles.agentMessage}>
          <Text style={[styles.agentMessageLabel, { color: desktop.terminalMuted }]}>
            Message to the agent
          </Text>
          <Text selectable style={[styles.description, { color: desktop.terminalForeground }]}>
            {readTerminalText(message)}
          </Text>
        </View>
      ) : null}
      {text ? <OutputText text={text} /> : null}
      {!text && !message ? (
        <Text style={[styles.description, { color: desktop.terminalMuted }]}>
          {readEmptyShellOutput(phase, supportsRunningCommandOutput)}
        </Text>
      ) : null}
    </ScrollView>
  );
}

/**
 * The details of a file edit with a change to show: its status and run facts, its error, and the
 * changes of each file, open. A tool run shows an edit on one line, so its changes show here.
 */
function FileEditDetails({
  meta,
  messageTimestamp,
  timeLabel,
}: { meta: ToolMeta } & DetailsTiming): ReactElement {
  const { desktop } = useAppTheme();
  const error = readToolDetailsError(meta);
  return (
    <ScrollView style={styles.fillHeight} contentContainerStyle={styles.padded}>
      <StatusLine
        meta={meta}
        messageTimestamp={messageTimestamp}
        timeLabel={timeLabel}
        exitCode={null}
        timeoutMs={null}
      />
      {error ? (
        <DetailsBlock label="Error" tone="error" copyText={error}>
          <PreText text={formatRawJsonLikeText(error)} color={desktop.destructiveMuted} />
        </DetailsBlock>
      ) : null}
      <ToolFileEdits meta={meta} resetKey={`details:${meta.callId}`} open />
    </ScrollView>
  );
}

function ToolCallDetails({
  meta,
  messageTimestamp,
  timeLabel,
}: { meta: ToolMeta } & DetailsTiming): ReactElement {
  const { desktop } = useAppTheme();
  const { workingDirectory, presentToolCall } = useTranscriptRows();
  // A workflow event shows its note before its input, as on desktop.
  const { note } = readToolDetailsHeading(meta, presentToolCall(meta.tool, meta.displayLabel));
  const { hasInput, hasOutput } = readToolDetailAvailability(meta);
  const input = useMemo(
    () => (meta.input && hasInput ? formatToolInput(meta.input, workingDirectory) : ""),
    [meta.input, hasInput, workingDirectory],
  );
  const error = readToolDetailsError(meta);
  return (
    <ScrollView style={styles.fillHeight} contentContainerStyle={styles.padded}>
      <StatusLine
        meta={meta}
        messageTimestamp={messageTimestamp}
        timeLabel={timeLabel}
        exitCode={null}
        timeoutMs={null}
      />
      {note ? (
        <View accessibilityLabel="Note" style={styles.block}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, styles.fill, { color: desktop.foreground }]}>
              Note
            </Text>
          </View>
          <MarkdownView markdown={note} selectable />
        </View>
      ) : null}
      {input ? (
        <DetailsBlock label="Input" copyText={input}>
          <PreText text={input} color={desktop.foreground} />
        </DetailsBlock>
      ) : null}
      {hasOutput ? (
        <DetailsBlock label="Output" copyText={meta.resultContent ? "" : (meta.output ?? "")}>
          <ToolOutput
            content={meta.resultContent}
            output={() => formatRawJsonLikeText(meta.output ?? "")}
            color={desktop.foreground}
          />
        </DetailsBlock>
      ) : null}
      {error ? (
        <DetailsBlock label="Error" tone="error" copyText={error}>
          <PreText text={formatRawJsonLikeText(error)} color={desktop.destructiveMuted} />
        </DetailsBlock>
      ) : null}
      {input || hasOutput || error ? null : (
        <Text style={[styles.meta, { color: desktop.mutedForeground }]}>
          The tool call has no input or output.
        </Text>
      )}
    </ScrollView>
  );
}

function DetailsBlock({
  label,
  tone = "default",
  copyText,
  children,
}: {
  label: string;
  tone?: "default" | "error";
  copyText: string;
  children: ReactNode;
}): ReactElement {
  const { desktop } = useAppTheme();
  const isError = tone === "error";
  return (
    <View style={styles.block}>
      <View style={styles.sectionHeader}>
        <Text
          style={[
            styles.sectionTitle,
            styles.fill,
            { color: isError ? desktop.destructiveMuted : desktop.foreground },
          ]}
        >
          {label}
        </Text>
        {copyText ? (
          <CopyControl
            text={copyText}
            what={label}
            accessibilityLabel={`Copy ${label.toLowerCase()}`}
            color={desktop.mutedForeground}
          />
        ) : null}
      </View>
      <View
        style={[
          styles.blockFrame,
          isError
            ? {
                borderColor: desktop.destructiveBorder,
                backgroundColor: desktop.destructiveSurface,
              }
            : { borderColor: desktop.border, backgroundColor: desktop.muted },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  fillHeight: { flex: 1 },
  padded: {
    gap: theme.space.md,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.sm,
    paddingBottom: theme.space.lg,
  },
  summary: {
    gap: theme.space.sm,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.sm,
    paddingBottom: theme.space.md,
  },
  description: { ...sansWeight("regular"), fontSize: 13.5, lineHeight: 19 },
  exitChip: {
    ...monoWeight("regular"),
    fontSize: 11.5,
    lineHeight: 16,
    paddingHorizontal: 6,
    borderRadius: theme.radius.xs,
    overflow: "hidden",
  },
  // The command area takes at most part of the sheet, so the output keeps room.
  commandArea: { flexGrow: 0, maxHeight: "45%" },
  commandText: { ...monoWeight("regular"), fontSize: 12.5, lineHeight: 19 },
  sectionLabel: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, minHeight: 28 },
  commandBlock: {
    flexDirection: "row",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
  },
  outputBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    minHeight: 28,
    paddingHorizontal: theme.layout.screenPadding,
  },
  // The output is the result of the call: an outlined block that takes the rest of the sheet.
  outputBlock: {
    flex: 1,
    marginHorizontal: theme.layout.screenPadding,
    marginTop: theme.space.xs,
    marginBottom: theme.space.md,
    borderWidth: 1,
    borderRadius: theme.radius.sm,
  },
  outputTitle: { ...sansWeight("medium"), fontSize: 13, lineHeight: 18 },
  outputContent: {
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  live: { flexDirection: "row", alignItems: "center", gap: 5 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  agentMessage: { gap: theme.space.xs },
  agentMessageLabel: { ...sansWeight("medium"), fontSize: 11.5, lineHeight: 16 },
  outputText: { ...monoWeight("regular"), fontSize: 12.5, lineHeight: 20 },
  outputBold: monoWeight("bold"),
  outputItalic: { fontStyle: "italic" },
  outputUnderline: { textDecorationLine: "underline" },
  fill: { flex: 1, minWidth: 0 },
  loading: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    padding: theme.layout.screenPadding,
  },
  retry: sansWeight("medium"),
  statusLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  status: { ...sansWeight("medium"), fontSize: 12.5, lineHeight: 18 },
  meta: { ...sansWeight("regular"), fontSize: 12.5, lineHeight: 18 },
  mono: { ...monoWeight("regular"), fontSize: 12.5, lineHeight: 19 },
  small: { fontSize: 11.5, lineHeight: 16 },
  cwd: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  sectionTitle: { ...sansWeight("medium"), fontSize: 13, lineHeight: 18 },
  block: { gap: 6 },
  blockFrame: {
    borderWidth: 1,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
}));
