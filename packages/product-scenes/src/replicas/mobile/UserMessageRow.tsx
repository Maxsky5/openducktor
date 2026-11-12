// A message of the user with its time, as user-message-row.tsx in
// apps/mobile/src/features/session/transcript/rows: a bubble at the trailing edge on the chat
// surface, and the time under it. A message that the agent has not read yet, such as a steered
// message, has a dashed violet outline and the Unread pill. A scene removes `data-unread` when
// the agent reads it. The text keeps its line breaks, as the app shows the review comments that
// go with a message.
import type { ReactElement } from "react";
import "./UserMessageRow.css";

type UserMessageRowProps = {
  text: string;
  /** The message time with seconds, such as 9:48:53 AM. */
  time: string;
  /** True while the agent has not read the message. */
  unread?: boolean | undefined;
  row?: string;
  hidden?: boolean | undefined;
};

export function UserMessageRow({
  text,
  time,
  unread = false,
  row,
  hidden,
}: UserMessageRowProps): ReactElement {
  return (
    <div
      className="mob-message"
      hidden={hidden}
      data-row={row}
      data-unread={unread ? "" : undefined}
    >
      <p className="mob-message-bubble">{text}</p>
      <div className="mob-message-meta">
        <span className="mob-message-unread">Unread</span>
        <span className="mob-message-time">{time}</span>
      </div>
    </div>
  );
}
