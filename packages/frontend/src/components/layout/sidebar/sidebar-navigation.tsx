import { Bot, Columns3 } from "lucide-react";
import { type ReactElement, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { preloadAgentsPage, preloadKanbanPage } from "@/pages";
import { sidebarNavLinkClassName } from "./sidebar-navigation-styles";

const NAV_ITEMS = [
  { to: "/kanban", icon: Columns3, label: "Kanban", requiresRepo: false },
  { to: "/agents", icon: Bot, label: "Agents", requiresRepo: true },
] as const;

type NavigationRoute = (typeof NAV_ITEMS)[number]["to"];

const ROUTE_PRELOADERS: Record<NavigationRoute, () => void> = {
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
  const location = useLocation();

  return (
    <SidebarNavigationLinks
      key={location.pathname}
      compact={compact}
      currentPathname={location.pathname}
      hasActiveWorkspace={hasActiveWorkspace}
    />
  );
}

type SidebarNavigationLinksProps = SidebarNavigationProps & {
  currentPathname: string;
};

function SidebarNavigationLinks({
  compact = false,
  currentPathname,
  hasActiveWorkspace,
}: SidebarNavigationLinksProps): ReactElement {
  const [activatedRoute, setActivatedRoute] = useState<NavigationRoute | null>(null);

  return (
    <nav className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isDisabled = item.requiresRepo && !hasActiveWorkspace;
        const preloadRoute = isDisabled ? undefined : ROUTE_PRELOADERS[item.to];
        const activateRoute =
          isDisabled || currentPathname === item.to ? undefined : () => setActivatedRoute(item.to);
        return (
          <NavLink
            key={item.to}
            to={isDisabled ? "/kanban" : item.to}
            title={item.label}
            aria-label={item.label}
            prefetch={isDisabled ? "none" : "intent"}
            onFocus={preloadRoute}
            onPointerEnter={preloadRoute}
            onClick={activateRoute}
            className={({ isActive }) =>
              sidebarNavLinkClassName({
                compact,
                isActive,
                isActivated: activatedRoute === item.to,
                isDisabled,
              })
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
