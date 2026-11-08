// An assistant message. The final message of a turn comes after the separator with the time of the
// turn, and it ends with the runtime, model, and effort. Sources: agent-chat-message-card.tsx and
// agent-transcript-separator.tsx. A final reply can end with the copy and fork buttons of
// agent-chat-assistant-message.tsx: a workspace session can fork from a completed reply.
import { Copy, GitFork } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import "./AgentText.css";

type AgentTextProps = {
  signature?: string | undefined;
  worked?: string | undefined;
  row?: string;
  /** The signature ends with the copy and fork buttons. The fork button has `data-fork`. */
  actions?: boolean;
  children?: ReactNode;
};

export function AgentText({
  signature,
  worked,
  row,
  actions = false,
  children,
}: AgentTextProps): ReactElement {
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
          {actions && (
            <span className="st-sig-actions">
              <span className="st-sig-action">
                <Copy />
              </span>
              <span className="st-sig-action" data-fork="">
                <GitFork />
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
