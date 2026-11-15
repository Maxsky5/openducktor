import type { ReactElement } from "react";
import {
  FILE_DIFF_UNAVAILABLE_MESSAGE,
  hasExpandableToolDetails,
  readToolDetailAvailability,
  readToolFileEdits,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { cn } from "@/lib/utils";
import { AgentChatFileEditCard } from "./agent-chat-file-edit-card";
import { QuestionToolAnswers } from "./agent-chat-question-tool-answers";
import { RegularToolSummary } from "./agent-chat-regular-tool-summary";
import { useToolDetailsRow } from "./agent-chat-tool-details-store";
import { TOOL_ROW_HOVER, TOOL_ROW_SELECTED } from "./agent-chat-tool-row-states";

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

      <QuestionToolAnswers meta={meta} />

      {fileEditData.map((data) => (
        <AgentChatFileEditCard key={data.filePath} data={data} />
      ))}
      {fileDiffUnavailable ? (
        <p className="text-xs text-muted-foreground">{FILE_DIFF_UNAVAILABLE_MESSAGE}</p>
      ) : null}
    </div>
  );
};
