// The Open In group of the session top bar, and the menu of the other tools. Sources: open-in-menu.tsx
// and open-in-tool-metadata.tsx in agent-studio-git-panel. Without an app icon, the product shows
// a fallback icon in a muted box. With `appIcon`, the default tool shows its app icon, as the
// top bar of a session does. The menu stays closed in the final frame.
import {
  AppWindowMac,
  ChevronDown,
  FolderOpen,
  LoaderCircle,
  type LucideIcon,
  SquareTerminal,
  Terminal,
} from "lucide-react";
import type { ReactElement } from "react";
import { OPEN_IN_TOOLS, type OpenInTool, WORKTREE_PATH } from "../../sample/worktree";
import { Button } from "../ui/Button";
import "./OpenInMenu.css";

type OpenInMenuProps = {
  /** The tool of the default button: the tool that opened the worktree last. */
  tool: OpenInTool;
  /** The group has the menu of the other tools, which a scene opens. */
  menu?: boolean;
  /** The default tool shows its app icon in place of the fallback icon. */
  appIcon?: boolean;
};

type ToolIcon = OpenInTool["icon"];

const ICONS = {
  folder: FolderOpen,
  terminal: Terminal,
  app: AppWindowMac,
} as const satisfies Record<ToolIcon, LucideIcon>;
const APP_ICONS = {
  folder: FolderOpen,
  terminal: SquareTerminal,
  app: AppWindowMac,
} as const satisfies Record<ToolIcon, LucideIcon>;

function ToolMenu(): ReactElement {
  return (
    <span className="oi-menu" hidden data-oi-menu="">
      <span className="oi-menu-head">
        <b>Other tools for task worktree</b>
        <small>{WORKTREE_PATH}</small>
      </span>
      <span className="oi-list">
        {OPEN_IN_TOOLS.map((item) => {
          const ItemIcon = ICONS[item.icon];
          return (
            <span className="oi-item" data-oi-item={item.label} key={item.label}>
              <span className="oi-icon">
                <ItemIcon className="i14" />
              </span>
              <span className="oi-label">{item.label}</span>
              <LoaderCircle className="i14 spin oi-spin" />
            </span>
          );
        })}
      </span>
    </span>
  );
}

export function OpenInMenu({ tool, menu = false, appIcon = false }: OpenInMenuProps): ReactElement {
  const Icon = ICONS[tool.icon];
  const AppIcon = APP_ICONS[tool.icon];
  return (
    <span className="oi" data-menu={menu ? "" : undefined} data-app-icon={appIcon ? "" : undefined}>
      <Button variant="outline" size="sm" className="oi-default">
        {appIcon ? (
          <span className="oi-app">
            <AppIcon className="i12" />
          </span>
        ) : (
          <span className="oi-icon">
            <Icon className="i14" />
          </span>
        )}
        {tool.label}
      </Button>
      <Button variant="outline" size="sm" className="oi-trigger" data-oi-trigger>
        <ChevronDown className={appIcon ? "i14" : "i12"} />
      </Button>
      {menu && <ToolMenu />}
    </span>
  );
}
