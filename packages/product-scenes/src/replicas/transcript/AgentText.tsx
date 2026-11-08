// An assistant message. The final message of a turn comes after the separator with the time of the
// turn, and it ends with the runtime, model, and effort. Sources: agent-chat-message-card.tsx and
// agent-transcript-separator.tsx.
import type { ReactElement, ReactNode } from "react";
import "./AgentText.css";

type AgentTextProps = {
  signature?: string | undefined;
  worked?: string | undefined;
  row?: string;
  children?: ReactNode;
};

export function AgentText({ signature, worked, row, children }: AgentTextProps): ReactElement {
  return (
    <div className="st-agent" data-row={row}>
      {worked && (
        <p className="st-worked">
          <span>Worked for {worked}</span>
        </p>
      )}
      <div className="st-agent-body" data-text="">
        {children}
      </div>
      {signature && (
        <div className="st-sig" data-sig="">
          <i />
          {signature}
        </div>
      )}
    </div>
  );
}
