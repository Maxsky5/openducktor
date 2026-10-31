import { type ReactElement, useMemo, useState } from "react";
import type { AgentToolData } from "@openducktor/contracts";
import { cn } from "@/lib/utils";
import { formatToolInput } from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { FullToolPartDetails } from "./agent-chat-tool-part-details";

type ToolInputDetailsProps = {
  meta: ToolMeta;
  workingDirectory?: string | null | undefined;
  className: string;
  textClassName: string;
  visible?: boolean;
};

/**
 * The Input box of a call. It formats the input only while it shows. When compact history cut the
 * call, the open box reads the full call first.
 */
export const ToolInputDetails = ({
  meta,
  workingDirectory,
  className,
  textClassName,
  visible = true,
}: ToolInputDetailsProps): ReactElement => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <details className={className} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className={cn("cursor-pointer px-2 py-1 text-xs font-medium", textClassName)}>
        Input
      </summary>
      {isOpen && visible ? (
        <div className="px-2 pb-2">
          {meta.detailsOmitted ? (
            <FullToolPartDetails meta={meta}>
              {(full) => (
                <ToolInputText
                  input={full.input}
                  workingDirectory={workingDirectory}
                  textClassName={textClassName}
                />
              )}
            </FullToolPartDetails>
          ) : (
            <ToolInputText
              input={meta.input}
              workingDirectory={workingDirectory}
              textClassName={textClassName}
            />
          )}
        </div>
      ) : null}
    </details>
  );
};

const ToolInputText = ({
  input,
  workingDirectory,
  textClassName,
}: {
  input: AgentToolData | undefined;
  workingDirectory?: string | null | undefined;
  textClassName: string;
}): ReactElement => {
  const formatted = useMemo(
    () => (input ? formatToolInput(input, workingDirectory) : ""),
    [input, workingDirectory],
  );
  return (
    <pre className={cn("overflow-x-auto whitespace-pre-wrap text-[11px]", textClassName)}>
      {formatted}
    </pre>
  );
};
