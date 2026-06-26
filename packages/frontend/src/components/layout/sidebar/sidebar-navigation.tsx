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
  linkTarget: NavigationRoute;
};

const isModifiedEvent = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;

const shouldActivateSidebarNavigation = ({
  currentPathname,
  event,
  isDisabled,
  linkTarget,
}: ShouldActivateSidebarNavigationArgs): boolean => {
  if (isDisabled || currentPathname === linkTarget || event.defaultPrevented) {
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
    linkTarget: NavigationRoute,
    isDisabled: boolean,
  ): void => {
    if (currentPathname === linkTarget) {
      setNavigationState({ activatedNavigation: null, committedLocationKey: currentLocationKey });
      return;
    }

    if (
      shouldActivateSidebarNavigation({
        currentPathname,
        event,
        isDisabled,
        linkTarget,
      })
    ) {
      setNavigationState({
        activatedNavigation: { route: linkTarget, sourceLocationKey: currentLocationKey },
        committedLocationKey: currentLocationKey,
      });
    }
  };

  return (
    <nav className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isDisabled = item.requiresRepo && !hasActiveWorkspace;
        const linkTarget: NavigationRoute = isDisabled ? "/kanban" : item.to;
        const preloadRoute = isDisabled ? undefined : ROUTE_PRELOADERS[item.to];
        const isActivated =
          activatedNavigation?.route === linkTarget &&
          activatedNavigation.sourceLocationKey === currentLocationKey;
        return (
          <NavLink
            key={item.to}
            to={linkTarget}
            title={item.label}
            aria-label={item.label}
            onFocus={preloadRoute}
            onPointerEnter={preloadRoute}
            onClick={(event) => activateRoute(event, linkTarget, isDisabled)}
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
