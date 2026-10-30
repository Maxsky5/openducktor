import { AgentToolResultContentView } from "./agent-tool-result-content";
import { type ReactElement, useState } from "react";
import { formatRawJsonLikeText } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model";
import {
  buildQuestionDetailEntries,
  FILE_DIFF_UNAVAILABLE_MESSAGE,
  hasExpandableToolDetails,
  NO_ANSWER_YET_LABEL,
  readToolDetailAvailability,
  readToolFileEdits,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { AgentChatFileEditCard } from "./agent-chat-file-edit-card";
import { RegularToolSummary } from "./agent-chat-regular-tool-summary";
import { AgentChatTranscriptProse } from "./agent-chat-transcript-prose";
import { ToolInputDetails } from "./agent-chat-tool-input-details";
import { FullToolPartDetails } from "./agent-chat-tool-part-details";

type RegularToolMessageProps = {
  meta: ToolMeta;
  messageContent: string;
  messageTimestamp: string;
  timeLabel: string;
  sessionWorkingDirectory?: string | null | undefined;
  displayName: string;
};

export const RegularToolMessage = ({
  meta,
  messageContent,
  messageTimestamp,
  timeLabel,
  sessionWorkingDirectory,
  displayName,
}: RegularToolMessageProps): ReactElement => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const availability = readToolDetailAvailability(meta);
  const { hasInput, hasOutput, hasError } = availability;
  const hasExpandableDetails = hasExpandableToolDetails(availability);
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
      hasExpandableDetails={hasExpandableDetails}
    />
  );

  return (
    <div className="space-y-1 px-1 py-0.5">
      {hasExpandableDetails ? (
        <details
          className="group"
          onToggle={(event) => {
            if (event.target === event.currentTarget) setDetailsOpen(event.currentTarget.open);
          }}
        >
          <summary className="list-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            {summaryRow}
          </summary>
          <div className="ml-5 mt-1 space-y-2">
            {detailsOpen && meta.detailsOmitted ? (
              <FullToolPartDetails meta={meta}>
                {(full) => (
                  <RegularToolInputOutput
                    meta={full}
                    hasInput={hasInput}
                    hasOutput={hasOutput}
                    sessionWorkingDirectory={sessionWorkingDirectory}
                    visible
                  />
                )}
              </FullToolPartDetails>
            ) : (
              <RegularToolInputOutput
                meta={meta}
                hasInput={hasInput}
                hasOutput={hasOutput}
                sessionWorkingDirectory={sessionWorkingDirectory}
                visible={detailsOpen}
              />
            )}
            {hasError && meta.error ? (
              <details className="rounded border border-destructive-border bg-destructive-surface">
                <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-destructive-muted">
                  Error
                </summary>
                <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-destructive-muted">
                  {formatRawJsonLikeText(meta.error)}
                </pre>
              </details>
            ) : null}
          </div>
        </details>
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

/** The Input and Output boxes of a call. */
const RegularToolInputOutput = ({
  meta,
  hasInput,
  hasOutput,
  sessionWorkingDirectory,
  visible,
}: {
  meta: ToolMeta;
  hasInput: boolean;
  hasOutput: boolean;
  sessionWorkingDirectory?: string | null | undefined;
  visible: boolean;
}): ReactElement => (
  <>
    {hasInput && meta.input ? (
      <ToolInputDetails
        input={meta.input}
        workingDirectory={sessionWorkingDirectory}
        className="rounded border border-border bg-card"
        textClassName="text-foreground"
        visible={visible}
      />
    ) : null}
    {hasOutput ? (
      <details className="rounded border border-border bg-card">
        <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-foreground">
          Output
        </summary>
        <div className="space-y-2 px-2 pb-2 text-[11px] text-foreground">
          <AgentToolResultContentView content={meta.resultContent} output={meta.output} />
        </div>
      </details>
    ) : null}
  </>
);
