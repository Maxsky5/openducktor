// The Quick actions menu of a task session, as session-header.tsx, session-header-menus.ts, and
// action-menu.tsx in apps/mobile/src: the zap button opens a card under it, aligned to its right
// edge, over a light scrim. The card names the menu, then lists the desktop quick actions, primary
// action first. A session action shows the icon of its role, and a task action its workflow icon.
// A destructive action shows in red after a divider. A disabled action tells why under its name.
// menus.ts opens and closes it by `data-menu`, and a scene finds an item by `data-menu-item`.
import { type LucideIcon } from "lucide-react";
import { Fragment, type ReactElement } from "react";
import { flag } from "../flag";
import { RoleIcon } from "../ui/RoleIcon";
import type { RoleId } from "../vocabulary";
import "./QuickActionsMenu.css";

export type MenuItem = {
  id: string;
  title: string;
  /** The role whose icon the item shows, or a lucide icon. */
  icon: { role: RoleId } | { Icon: LucideIcon };
  detail?: string;
  destructive?: boolean;
  disabled?: boolean;
};

type QuickActionsMenuProps = {
  items: readonly MenuItem[];
  hidden?: boolean | undefined;
};

function ItemIcon({ icon }: { icon: MenuItem["icon"] }): ReactElement {
  return "role" in icon ? <RoleIcon role={icon.role} /> : <icon.Icon />;
}

export function QuickActionsMenu({ items, hidden }: QuickActionsMenuProps): ReactElement {
  // The menu lists the destructive actions last, after one divider.
  const ordered = [
    ...items.filter((item) => item.destructive !== true),
    ...items.filter((item) => item.destructive === true),
  ];
  return (
    <div className="mob-qmenu-layer" hidden={hidden} data-menu="quick">
      <i className="mob-qmenu-scrim" />
      <div className="mob-qmenu" data-menu-card="">
        <span className="mob-qmenu-title">Quick Actions</span>
        {ordered.map((item, index) => {
          const previous = ordered[index - 1];
          const divides = item.destructive === true && previous?.destructive !== true;
          return (
            <Fragment key={item.id}>
              {divides && <i className="mob-qmenu-divider" />}
              <span
                className="mob-qmenu-item"
                data-destructive={flag(item.destructive)}
                data-disabled={flag(item.disabled)}
                data-menu-item={item.id}
              >
                <ItemIcon icon={item.icon} />
                <span className="mob-qmenu-text">
                  <b>{item.title}</b>
                  {item.detail && <span>{item.detail}</span>}
                </span>
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
