import { type ReactElement, useState } from "react";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { AgentToolResultContentView } from "./agent-tool-result-content";
import { FullToolPartDetails } from "./agent-chat-tool-part-details";

/**
 * The Output box of a call. When compact history cut the call, the box reads the full call when
 * it opens.
 */
export const ToolOutputDetails = ({
  meta,
  className,
  summaryClassName,
  bodyClassName,
}: {
  meta: ToolMeta;
  className: string;
  summaryClassName: string;
  bodyClassName: string;
}): ReactElement => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <details className={className} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className={summaryClassName}>Output</summary>
      <div className={bodyClassName}>
        {!meta.detailsOmitted ? (
          <AgentToolResultContentView content={meta.resultContent} output={meta.output} />
        ) : isOpen ? (
          <FullToolPartDetails meta={meta}>
            {(full) => (
              <AgentToolResultContentView content={full.resultContent} output={full.output} />
            )}
          </FullToolPartDetails>
        ) : null}
      </div>
    </details>
  );
};
