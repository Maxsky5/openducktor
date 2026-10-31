import { type ReactElement, type ReactNode, useState } from "react";
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
  let body: ReactNode = null;
  if (!meta.detailsOmitted) body = renderOutput(meta);
  else if (isOpen) body = <FullToolPartDetails meta={meta}>{renderOutput}</FullToolPartDetails>;
  return (
    <details className={className} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className={summaryClassName}>Output</summary>
      <div className={bodyClassName}>{body}</div>
    </details>
  );
};

const renderOutput = (meta: ToolMeta): ReactElement => (
  <AgentToolResultContentView content={meta.resultContent} output={meta.output} />
);
