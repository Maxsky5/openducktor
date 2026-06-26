import { Bot, Columns3 } from "lucide-react";
import { type MouseEvent, type ReactElement, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { preloadAgentsPage, preloadKanbanPage } from "@/pages";
import { sidebarNavLinkClassName } from "./sidebar-navigation-styles";

const NAV_ITEMS = [
  { to: "/kanban", icon: Columns3, label: "Kanban", requiresRepo: false },
  { to: "/agents", icon: Bot, label: "Agents", requiresRepo: true },
] as const;

type NavigationRoute = (typeof NAV_ITEMS)[number]["to"];

type ActivatedNavigation = {
  route: NavigationRoute;
  sourceLocationKey: string;
};

type SidebarNavigationState = {
  activatedNavigation: ActivatedNavigation | null;
  committedLocationKey: string;
};

const ROUTE_PRELOADERS: Record<NavigationRoute, () => void> = {
  "/agents": preloadAgentsPage,
  "/kanban": preloadKanbanPage,
};

type SidebarNavigationProps = {
  hasActiveWorkspace: boolean;
  compact?: boolean;
};

type ShouldActivateSidebarNavigationArgs = {
  currentPathname: string;
  event: MouseEvent<HTMLAnchorElement>;
  isDisabled: boolean;
  targetPathname: NavigationRoute;
};

const isModifiedEvent = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;

const shouldActivateSidebarNavigation = ({
  currentPathname,
  event,
  isDisabled,
  targetPathname,
}: ShouldActivateSidebarNavigationArgs): boolean => {
  if (isDisabled || currentPathname === targetPathname || event.defaultPrevented) {
    return false;
  }

  const target = event.currentTarget.getAttribute("target");

  return event.button === 0 && (!target || target === "_self") && !isModifiedEvent(event);
};

export function SidebarNavigation({
  hasActiveWorkspace,
  compact = false,
}: SidebarNavigationProps): ReactElement {
  const location = useLocation();

  const currentPathname = location.pathname;
  const currentLocationKey = location.key;
  const [navigationState, setNavigationState] = useState<SidebarNavigationState>(() => ({
    activatedNavigation: null,
    committedLocationKey: currentLocationKey,
  }));
  let activatedNavigation = navigationState.activatedNavigation;

  if (navigationState.committedLocationKey !== currentLocationKey) {
    // Reset during render so restored history entries cannot revive stale optimistic feedback.
    activatedNavigation = null;
    setNavigationState({ activatedNavigation: null, committedLocationKey: currentLocationKey });
  }

  const activateRoute = (
    event: MouseEvent<HTMLAnchorElement>,
    item: (typeof NAV_ITEMS)[number],
  ): void => {
    const isDisabled = item.requiresRepo && !hasActiveWorkspace;

    if (currentPathname === item.to) {
      setNavigationState({ activatedNavigation: null, committedLocationKey: currentLocationKey });
      return;
    }

    if (
      shouldActivateSidebarNavigation({
        currentPathname,
        event,
        isDisabled,
        targetPathname: item.to,
      })
    ) {
      setNavigationState({
        activatedNavigation: { route: item.to, sourceLocationKey: currentLocationKey },
        committedLocationKey: currentLocationKey,
      });
    }
  };

  return (
    <nav className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isDisabled = item.requiresRepo && !hasActiveWorkspace;
        const preloadRoute = isDisabled ? undefined : ROUTE_PRELOADERS[item.to];
        const isActivated =
          activatedNavigation?.route === item.to &&
          activatedNavigation.sourceLocationKey === currentLocationKey;
        return (
          <NavLink
            key={item.to}
            to={isDisabled ? "/kanban" : item.to}
            title={item.label}
            aria-label={item.label}
            prefetch={isDisabled ? "none" : "intent"}
            onFocus={preloadRoute}
            onPointerEnter={preloadRoute}
            onClick={(event) => activateRoute(event, item)}
            className={({ isActive }) =>
              sidebarNavLinkClassName({
                compact,
                isActive,
                isActivated,
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
