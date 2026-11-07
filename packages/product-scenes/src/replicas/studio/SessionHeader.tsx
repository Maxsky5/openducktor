// The top bar of a session page in session-page-header.tsx: the title on the left, then the
// session actions, Open In, and the panel toggles. Every control is 28 pixels tall. A task session
// and a chat give their own title and actions.
import type { ReactElement, ReactNode } from "react";
import "./SessionHeader.css";

type SessionHeaderProps = {
  /** The title on the left. */
  title: ReactNode;
  /** The actions on the right. */
  children?: ReactNode;
};

export function SessionHeader({ title, children }: SessionHeaderProps): ReactElement {
  return (
    <div className="sh">
      <div className="sh-title">{title}</div>
      <div className="sh-actions">{children}</div>
    </div>
  );
}
