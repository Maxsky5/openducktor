import { Columns3 } from "lucide-react";
import { type MouseEvent, type ReactElement, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { cn } from "@/lib/utils";

const KANBAN_ROUTE = "/kanban";

type SidebarNavigationState = {
  isActivated: boolean;
  committedLocationKey: string;
};

type SidebarNavigationProps = {
  compact?: boolean;
  onBeforeNavigate?: (apply: () => void, cancel?: () => void) => void;
};

const isModifiedEvent = (event: MouseEvent<HTMLAnchorElement>): boolean =>
  event.metaKey || event.altKey || event.ctrlKey || event.shiftKey;

const shouldActivateSidebarNavigation = (
  currentPathname: string,
  event: MouseEvent<HTMLAnchorElement>,
): boolean => {
  if (currentPathname === KANBAN_ROUTE || event.defaultPrevented) {
    return false;
  }

  const target = event.currentTarget.getAttribute("target");

  return event.button === 0 && (!target || target === "_self") && !isModifiedEvent(event);
};

/** The Kanban link. Sessions have their own list, so the sidebar keeps no page links for them. */
export function SidebarNavigation({
  compact = false,
  onBeforeNavigate,
}: SidebarNavigationProps): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();

  const currentPathname = location.pathname;
  const currentLocationKey = location.key;
  const [navigationState, setNavigationState] = useState<SidebarNavigationState>(() => ({
    isActivated: false,
    committedLocationKey: currentLocationKey,
  }));
  let isActivated = navigationState.isActivated;

  if (navigationState.committedLocationKey !== currentLocationKey) {
    // Reset during render so restored history entries cannot revive stale optimistic feedback.
    isActivated = false;
    setNavigationState({ isActivated: false, committedLocationKey: currentLocationKey });
  }

  const activateRoute = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!shouldActivateSidebarNavigation(currentPathname, event)) {
      return;
    }
    setNavigationState({ isActivated: true, committedLocationKey: currentLocationKey });
    if (onBeforeNavigate) {
      event.preventDefault();
      onBeforeNavigate(
        () => navigate(KANBAN_ROUTE),
        () => setNavigationState({ isActivated: false, committedLocationKey: currentLocationKey }),
      );
    }
  };

  return (
    <nav aria-label="Pages">
      <NavLink
        to={KANBAN_ROUTE}
        title="Kanban"
        aria-label="Kanban"
        onClick={activateRoute}
        className={({ isActive }) =>
          cn(
            "flex h-9 cursor-pointer items-center rounded-md text-sm font-medium",
            compact ? "size-9 justify-center" : "gap-2 px-3",
            isActive || isActivated
              ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
              : "text-sidebar-foreground hover:bg-accent hover:text-accent-foreground",
          )
        }
      >
        <Columns3 className="size-4" />
        {compact ? null : "Kanban"}
      </NavLink>
    </nav>
  );
}
