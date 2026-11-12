// A menu of the mobile app, as action-menu.tsx and anchored-popover.tsx in apps/mobile/src/ui: a
// light scrim over the screen and a card next to its trigger, with an optional title line in small
// capitals and the actions with their icons. The card is 248 points wide. menus.ts places it next
// to its trigger, opens it, and closes it.
import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import "./ActionMenu.css";

/** One action of a menu. */
export type MenuAction = { id: string; title: string; icon: LucideIcon };

type ActionMenuProps = {
  /** The hook that menus.ts uses to find the menu. */
  menu: string;
  /** The line over the actions, such as the role, the runtime, and the model of a session. */
  title?: string;
  actions: readonly MenuAction[];
};

export function ActionMenu({ menu, title, actions }: ActionMenuProps): ReactElement {
  return (
    <div className="mob-menu-layer" data-menu={menu} hidden>
      <i className="mob-menu-scrim" />
      <div className="mob-menu" data-menu-card="">
        {title && <span className="mob-menu-title">{title}</span>}
        {actions.map(({ id, title: label, icon: Icon }) => (
          <span key={id} className="mob-menu-item" data-menu-item={id}>
            <Icon />
            <span>{label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
