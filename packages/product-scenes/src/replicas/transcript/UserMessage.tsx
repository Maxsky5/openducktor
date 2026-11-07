// A kickoff or user message: agent-chat-message-card.tsx draws it as a bubble on the right, on the
// chat surface, with the time below it.
import type { ReactElement, ReactNode } from "react";
import "./UserMessage.css";

type UserMessageProps = { time: string; row?: string; children?: ReactNode };

export function UserMessage({ time, row, children }: UserMessageProps): ReactElement {
  return (
    <div className="st-user" data-row={row}>
      <p>{children}</p>
      <time>{time}</time>
    </div>
  );
}
