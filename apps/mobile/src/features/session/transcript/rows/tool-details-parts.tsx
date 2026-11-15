import { plural } from "@openducktor/frontend-core/lib/plural";
import {
  formatToolInput,
  readToolDetailAvailability,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { formatRawJsonLikeText } from "@openducktor/frontend-core/sessions/messages/message-formatting";
import { getToolDuration } from "@openducktor/frontend-core/sessions/messages/tool-duration";
import { getToolLifecyclePhase } from "@openducktor/frontend-core/sessions/messages/tool-lifecycle";
import { formatAgentDuration } from "@openducktor/frontend-core/sessions/transcript/format-agent-duration";
import { type ReactElement, type ReactNode, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { monoWeight, sansWeight } from "@/theme/tokens";
import { Text } from "@/ui/text";
import { useTranscriptRows } from "../transcript-rows-context";
import { CopyControl, PreText } from "./row-parts";
import { ToolOutput } from "./tool-details";
import { ToolStatusIcon, ToolStatusLabel } from "./tool-status";

// The parts of the tool details sheet that its views share, as `agent-chat-tool-details-content.tsx`
// on desktop.

export type DetailsTiming = { messageTimestamp: string; timeLabel: string };

/** The status, run time, clock time, and exit code of a call, on one line. */
export function StatusLine({
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

/** The input and the output of a call, each in a block that the reader can copy. */
export function ToolCallInputOutput({ meta }: { meta: ToolMeta }): ReactElement {
  const { desktop } = useAppTheme();
  const { workingDirectory } = useTranscriptRows();
  const { hasInput, hasOutput } = readToolDetailAvailability(meta);
  const input = useMemo(
    () => (meta.input && hasInput ? formatToolInput(meta.input, workingDirectory) : ""),
    [meta.input, hasInput, workingDirectory],
  );
  return (
    <>
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
    </>
  );
}

/** The error of a failed call, which the reader can copy. */
export function DetailsError({ error }: { error: string }): ReactElement {
  const { desktop } = useAppTheme();
  return (
    <DetailsBlock label="Error" tone="error" copyText={error}>
      <PreText text={formatRawJsonLikeText(error)} color={desktop.destructiveMuted} />
    </DetailsBlock>
  );
}

export function DetailsBlock({
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
  exitChip: {
    ...monoWeight("regular"),
    fontSize: 11.5,
    lineHeight: 16,
    paddingHorizontal: 6,
    borderRadius: theme.radius.xs,
    overflow: "hidden",
  },
  fill: { flex: 1, minWidth: 0 },
  statusLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  status: { ...sansWeight("medium"), fontSize: 12.5, lineHeight: 18 },
  meta: { ...sansWeight("regular"), fontSize: 12.5, lineHeight: 18 },
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
