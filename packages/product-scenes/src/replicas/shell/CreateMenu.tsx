// The menu of the arrow beside New task in session-create-split-action.tsx: a popover with one
// ghost button for each action of the workspace. The label of the issue import names the Git
// provider of the workspace. A scene places the menu under the arrow, and `data-hover` shows the
// item under the pointer.
import { Archive, Download, Import, type LucideIcon, MessageCirclePlus } from "lucide-react";
import type { ReactElement } from "react";
import "./CreateMenu.css";

/** The actions of the menu. A scene finds an item by its action. */
export type CreateAction = "session" | "import-tasks" | "archived" | "import-session";

type CreateMenuProps = {
  /** The label of the issue import, such as Import tasks from GitHub Issues. */
  importLabel: string;
};

export function CreateMenu({ importLabel }: CreateMenuProps): ReactElement {
  const items: readonly { action: CreateAction; label: string; Icon: LucideIcon }[] = [
    { action: "session", label: "New session", Icon: MessageCirclePlus },
    { action: "import-tasks", label: importLabel, Icon: Download },
    { action: "archived", label: "Archived sessions", Icon: Archive },
    { action: "import-session", label: "Import session from an external runtime", Icon: Import },
  ];
  return (
    <div className="nc" data-create-menu="">
      {items.map(({ action, label, Icon }) => (
        <span className="nc-item" data-create-item={action} key={action}>
          <Icon />
          <span>{label}</span>
        </span>
      ))}
    </div>
  );
}
