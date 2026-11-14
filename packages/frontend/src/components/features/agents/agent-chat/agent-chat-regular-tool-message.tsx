import type { ReactElement } from "react";
import {
  buildQuestionDetailEntries,
  FILE_DIFF_UNAVAILABLE_MESSAGE,
  hasExpandableToolDetails,
  NO_ANSWER_YET_LABEL,
  readToolDetailAvailability,
  readToolFileEdits,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { cn } from "@/lib/utils";
import { AgentChatFileEditCard } from "./agent-chat-file-edit-card";
import { RegularToolSummary } from "./agent-chat-regular-tool-summary";
import { useToolDetailsRow } from "./agent-chat-tool-details-store";
import { TOOL_ROW_HOVER, TOOL_ROW_SELECTED } from "./agent-chat-tool-row-states";
import { AgentChatTranscriptProse } from "./agent-chat-transcript-prose";

type RegularToolMessageProps = {
  meta: ToolMeta;
  messageId: string;
  messageContent: string;
  messageTimestamp: string;
  timeLabel: string;
  sessionWorkingDirectory?: string | null | undefined;
  displayName: string;
};

/**
 * One compact line of a tool call. A press on a call with input, output, or an error shows them
 * in the tool details panel. Question answers and file edit cards show under the line.
 */
export const RegularToolMessage = ({
  meta,
  messageId,
  messageContent,
  messageTimestamp,
  timeLabel,
  sessionWorkingDirectory,
  displayName,
}: RegularToolMessageProps): ReactElement => {
  const details = useToolDetailsRow(messageId);
  const hasDetails = hasExpandableToolDetails(readToolDetailAvailability(meta));
  const { edits: fileEditData, diffUnavailable: fileDiffUnavailable } = readToolFileEdits(
    meta,
    sessionWorkingDirectory,
  );
  const questionDetailRenderEntries = buildQuestionDetailEntries(meta);

  const summaryRow = (
    <RegularToolSummary
      meta={meta}
      messageContent={messageContent}
      messageTimestamp={messageTimestamp}
      timeLabel={timeLabel}
      sessionWorkingDirectory={sessionWorkingDirectory}
      displayName={displayName}
    />
  );

  return (
    <div className="space-y-1 px-1 py-0.5">
      {details && hasDetails ? (
        <button
          type="button"
          aria-pressed={details.isShown}
          className={cn(
            "relative -mx-2 block w-[calc(100%+1rem)] cursor-pointer rounded-[7px] px-2 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
            details.isShown ? TOOL_ROW_SELECTED : TOOL_ROW_HOVER,
          )}
          onClick={details.onClick}
        >
          {summaryRow}
        </button>
      ) : (
        summaryRow
      )}

      {questionDetailRenderEntries.length > 0 ? (
        <details className="ml-5 rounded border border-border bg-muted/90">
          <summary className="cursor-pointer px-2 py-1 text-[11px] font-medium text-foreground">
            Questions and answers
          </summary>
          <div className="space-y-2 border-t border-border p-2 text-xs text-foreground">
            {questionDetailRenderEntries.map(({ key, detail }) => (
              <div key={key} className="space-y-0.5">
                <AgentChatTranscriptProse className="font-medium text-foreground">
                  {detail.prompt}
                </AgentChatTranscriptProse>
                <AgentChatTranscriptProse
                  className={
                    detail.answers.length > 0 ? "text-foreground" : "italic text-muted-foreground"
                  }
                >
                  {detail.answers.length > 0 ? detail.answers.join(", ") : NO_ANSWER_YET_LABEL}
                </AgentChatTranscriptProse>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {fileEditData.map((data) => (
        <AgentChatFileEditCard key={data.filePath} data={data} />
      ))}
      {fileDiffUnavailable ? (
        <p className="text-xs text-muted-foreground">{FILE_DIFF_UNAVAILABLE_MESSAGE}</p>
      ) : null}
    </div>
  );
};
