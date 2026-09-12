import { type ReactElement, useState } from "react";
import {
  extractAllFileEditData,
  formatRawJsonLikeText,
  hasNonEmptyInput,
  hasNonEmptyText,
  type QuestionToolDetail,
  questionToolDetails,
} from "./agent-chat-message-card-model";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { AgentChatFileEditCard } from "./agent-chat-file-edit-card";
import { RegularToolSummary } from "./agent-chat-regular-tool-summary";
import { AgentChatTranscriptProse } from "./agent-chat-transcript-prose";
import { ToolInputDetails } from "./agent-chat-tool-input-details";

const buildQuestionDetailRenderEntries = (
  callId: string,
  questionDetails: QuestionToolDetail[],
): Array<{ key: string; detail: QuestionToolDetail }> => {
  const countsByBaseKey = new Map<string, number>();

  return questionDetails.map((detail) => {
    const baseKey = `${callId}:question:${detail.prompt}:${detail.answers.join("|")}`;
    const nextCount = (countsByBaseKey.get(baseKey) ?? 0) + 1;
    countsByBaseKey.set(baseKey, nextCount);
    return {
      key: `${baseKey}:${nextCount}`,
      detail,
    };
  });
};

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
  const hasInput = hasNonEmptyInput(meta.input);
  const hasOutput = hasNonEmptyText(meta.output);
  const hasError = hasNonEmptyText(meta.error);
  const hasExpandableDetails = hasInput || hasOutput || hasError;
  const questionDetails = questionToolDetails(meta);
  const questionDetailRenderEntries = buildQuestionDetailRenderEntries(
    meta.callId,
    questionDetails,
  );

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
          <summary className="list-none [&::-webkit-details-marker]:hidden">{summaryRow}</summary>
          <div className="ml-5 mt-1 space-y-2">
            {hasInput && meta.input ? (
              <ToolInputDetails
                input={meta.input}
                workingDirectory={sessionWorkingDirectory}
                className="rounded border border-border bg-card"
                textClassName="text-foreground"
                visible={detailsOpen}
              />
            ) : null}
            {hasOutput && meta.output ? (
              <details className="rounded border border-border bg-card">
                <summary className="cursor-pointer px-2 py-1 text-xs font-medium text-foreground">
                  Output
                </summary>
                <pre className="overflow-x-auto whitespace-pre-wrap px-2 pb-2 text-[11px] text-foreground">
                  {formatRawJsonLikeText(meta.output)}
                </pre>
              </details>
            ) : null}
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

      {questionDetails.length > 0 ? (
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
                  {detail.answers.length > 0 ? detail.answers.join(", ") : "No answer yet"}
                </AgentChatTranscriptProse>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {meta.toolType === "file_edit" &&
        (() => {
          const allFileEditData = extractAllFileEditData(meta, sessionWorkingDirectory);
          return allFileEditData.length > 0
            ? allFileEditData.map((data) => (
                <AgentChatFileEditCard key={data.filePath} data={data} />
              ))
            : null;
        })()}
    </div>
  );
};
