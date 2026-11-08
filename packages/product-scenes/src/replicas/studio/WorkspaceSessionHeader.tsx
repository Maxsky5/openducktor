// The top bar of a session outside a task in workspace-session-header.tsx: the title, the actions
// in the children, the folder of the session, Archive with its menu, Open In, and the panel toggles
// with the right panel closed.
import { Archive, Folder } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { OPEN_IN_TERMINAL } from "../../sample/worktree";
import { OpenInMenu } from "./OpenInMenu";
import { PanelToggles } from "./PanelToggles";
import { SessionHeader, SplitAction } from "./SessionHeader";

type WorkspaceSessionHeaderProps = {
  title: string;
  /** The actions before the folder, such as the repository actions of a chat. */
  children?: ReactNode;
};

export function WorkspaceSessionHeader({
  title,
  children,
}: WorkspaceSessionHeaderProps): ReactElement {
  return (
    <SessionHeader
      title={
        <span className="sh-name">
          <span>{title}</span>
        </span>
      }
    >
      {children}
      <span className="sh-icon">
        <Folder />
      </span>
      <SplitAction icon={Archive} label="Archive" />
      <OpenInMenu tool={OPEN_IN_TERMINAL} appIcon />
      <PanelToggles right={false} />
    </SessionHeader>
  );
}
