import {
  FILE_DIFF_UNAVAILABLE_MESSAGE,
  readToolDetailsError,
  readToolFileEdits,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import type { ReactElement, ReactNode } from "react";
import { AgentChatFileEditCard } from "./agent-chat-file-edit-card";
import { toolIcon } from "./agent-chat-tool-icon";
import {
  DetailsError,
  DetailsHeading,
  type ToolDetailsTiming,
} from "./agent-chat-tool-details-content";

/**
 * The details of a file edit: the tool, its status and run facts, its error, and the changes of
 * each file, open. A tool run shows an edit on one line, so its changes show here.
 */
export const FileEditDetails = ({
  meta,
  title,
  workingDirectory,
  closeAction,
  messageTimestamp,
  timeLabel,
}: {
  meta: ToolMeta;
  title: string;
  workingDirectory: string | null;
  closeAction?: ReactNode;
} & ToolDetailsTiming): ReactElement => {
  const { edits, diffUnavailable } = readToolFileEdits(meta, workingDirectory);
  const error = readToolDetailsError(meta);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-4 pb-5">
        <DetailsHeading
          icon={toolIcon(meta)}
          title={title}
          meta={meta}
          messageTimestamp={messageTimestamp}
          timeLabel={timeLabel}
          closeAction={closeAction}
        />
        {error ? <DetailsError error={error} /> : null}
        {edits.length > 0 ? (
          <section aria-label="Changes" className="space-y-2">
            {edits.map((data) => (
              <AgentChatFileEditCard key={data.filePath} data={data} defaultExpanded />
            ))}
          </section>
        ) : null}
        {diffUnavailable ? (
          <p className="text-xs leading-5 text-muted-foreground">{FILE_DIFF_UNAVAILABLE_MESSAGE}</p>
        ) : null}
        {edits.length === 0 && !error ? (
          <p className="text-xs leading-5 text-muted-foreground">
            The edit has no changes to show yet.
          </p>
        ) : null}
      </div>
    </div>
  );
};
