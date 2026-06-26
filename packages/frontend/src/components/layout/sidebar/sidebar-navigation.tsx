import { Bot, Columns3 } from "lucide-react";
import type { ReactElement } from "react";
import { NavLink } from "react-router-dom";
import { preloadAgentsPage, preloadKanbanPage } from "@/pages";
import { sidebarNavLinkClassName } from "./sidebar-navigation-styles";

const NAV_ITEMS = [
  { to: "/kanban", icon: Columns3, label: "Kanban", requiresRepo: false },
  { to: "/agents", icon: Bot, label: "Agents", requiresRepo: true },
] as const;

const ROUTE_PRELOADERS: Record<(typeof NAV_ITEMS)[number]["to"], () => void> = {
  "/agents": preloadAgentsPage,
  "/kanban": preloadKanbanPage,
};

type SidebarNavigationProps = {
  hasActiveWorkspace: boolean;
  compact?: boolean;
};

export function SidebarNavigation({
  hasActiveWorkspace,
  compact = false,
}: SidebarNavigationProps): ReactElement {
  return (
    <nav className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isDisabled = item.requiresRepo && !hasActiveWorkspace;
        const preloadRoute = isDisabled ? undefined : ROUTE_PRELOADERS[item.to];
        return (
          <NavLink
            key={item.to}
            to={isDisabled ? "/kanban" : item.to}
            title={item.label}
            aria-label={item.label}
            prefetch={isDisabled ? "none" : "intent"}
            onFocus={preloadRoute}
            onPointerEnter={preloadRoute}
            className={({ isActive, isPending }) =>
              sidebarNavLinkClassName({ compact, isActive, isDisabled, isPending })
            }
            aria-disabled={isDisabled}
          >
            <Icon className="size-4" />
            {!compact ? item.label : null}
          </NavLink>
        );
      })}
    </nav>
  );
}
