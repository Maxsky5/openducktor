import { type ReactElement, useState } from "react";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { AgentToolResultContentView } from "./agent-tool-result-content";
import { FullToolPartDetails } from "./agent-chat-tool-part-details";

/**
 * The Output box of a call. It renders the output only while it shows. When compact history cut
 * the call, the open box reads the full call first.
 */
export const ToolOutputDetails = ({
  meta,
  className,
  summaryClassName,
  bodyClassName,
  visible = true,
}: {
  meta: ToolMeta;
  className: string;
  summaryClassName: string;
  bodyClassName: string;
  visible?: boolean;
}): ReactElement => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <details className={className} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className={summaryClassName}>Output</summary>
      {isOpen && visible ? (
        <div className={bodyClassName}>
          {meta.detailsOmitted?.output ? (
            <FullToolPartDetails meta={meta}>{renderOutput}</FullToolPartDetails>
          ) : (
            renderOutput(meta)
          )}
        </div>
      ) : null}
    </details>
  );
};

const renderOutput = (meta: ToolMeta): ReactElement => (
  <AgentToolResultContentView content={meta.resultContent} output={meta.output} />
);
