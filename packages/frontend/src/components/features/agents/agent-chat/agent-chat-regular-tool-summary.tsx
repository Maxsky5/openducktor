import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { getToolLifecyclePhase } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model";
import {
  isRegularToolPreparing,
  readRegularToolTiming,
  readToolCallFilePath,
  readToolCallName,
  resolveRegularToolSummary,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { FileTypeIcon } from "@/components/ui/file-type-icon";
import { ToolMessageTiming } from "./agent-chat-tool-message-timing";
import { ToolCallIcon } from "./agent-chat-tool-status";
import { useValueAtMount } from "./use-value-at-mount";

type RegularToolSummaryProps = {
  meta: ToolMeta;
  messageContent: string;
  messageTimestamp: string;
  timeLabel: string;
  sessionWorkingDirectory?: string | null | undefined;
  displayName: string;
};

const TOOL_TEXT_COLORS = {
  preparing: "text-muted-foreground",
  queued: "text-muted-foreground",
  executing: "text-foreground",
  completed: "text-foreground",
  failed: "text-destructive-muted",
  cancelled: "text-cancelled-muted",
} satisfies Record<ReturnType<typeof getToolLifecyclePhase>, string>;

/**
 * The line of a tool call: its icon, name, summary, and timing. A failed call keeps its summary
 * and shows the first line of its error under it, so its height stays two lines at most.
 */
export const RegularToolSummary = ({
  meta,
  messageContent,
  messageTimestamp,
  timeLabel,
  sessionWorkingDirectory,
  displayName,
}: RegularToolSummaryProps): ReactElement => {
  const lifecyclePhase = getToolLifecyclePhase(meta);
  const summary = resolveRegularToolSummary(meta, messageContent, sessionWorkingDirectory);
  const filePath = readToolCallFilePath(meta, sessionWorkingDirectory);
  const { durationMs } = readRegularToolTiming(meta, messageTimestamp);
  // A summary or an error that a new state of the call brings fades or opens in.
  const mountPhase = useValueAtMount(lifecyclePhase);
  const mountHadError = useValueAtMount(summary.errorPreview !== null);
  return (
    <span
      data-slot="tool-line"
      className={cn(
        "flex min-w-0 flex-col text-xs",
        isRegularToolPreparing(meta) && "opacity-50",
        TOOL_TEXT_COLORS[lifecyclePhase],
      )}
    >
      <span className="flex min-h-6 min-w-0 items-center gap-2">
        <ToolCallIcon meta={meta} phase={lifecyclePhase} />
        <span data-slot="tool-name" className="shrink-0 font-medium text-current">
          {readToolCallName(meta, displayName)}
        </span>
        {summary.text.length > 0 ? (
          <span
            data-slot="tool-summary"
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5",
              lifecyclePhase !== mountPhase && "tool-line-swap-in",
            )}
          >
            {filePath ? <FileTypeIcon filePath={filePath} /> : null}
            <span className="min-w-0 truncate text-foreground/75">{summary.text}</span>
          </span>
        ) : null}
        <ToolMessageTiming
          activity={null}
          durationMs={durationMs}
          timeLabel={timeLabel}
          className="text-foreground/75"
        />
      </span>
      {summary.errorPreview ? (
        // The line starts under the tool name: the 14 px icon and the 8 px gap.
        <span
          data-slot="tool-error-preview"
          className={cn(
            "truncate pb-0.5 pl-[22px] text-[11px] leading-4 text-destructive-muted",
            !mountHadError && "tool-line-error-in",
          )}
        >
          {summary.errorPreview}
        </span>
      ) : null}
    </span>
  );
};
