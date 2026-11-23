import { ChartSpline, Columns3, type LucideIcon, Workflow } from "lucide-react";
import { type MouseEvent, type ReactElement, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { useShortcutTitle } from "@/features/shortcuts/shortcut-controls";
import { WORKFLOWS_ROUTE } from "@/features/workflows/workflow-routes";
import { USAGE_PATH } from "@/pages";

const KANBAN_ROUTE = "/kanban";

type SidebarNavigationState = {
  /** The page link that shows as selected before its route commits. */
  activatedRoute: string | null;
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
  route: string,
  event: MouseEvent<HTMLAnchorElement>,
): boolean => {
  if (currentPathname === route || event.defaultPrevented) {
    return false;
  }

  const target = event.currentTarget.getAttribute("target");

  return event.button === 0 && (!target || target === "_self") && !isModifiedEvent(event);
};

type SidebarPageLink = {
  route: string;
  label: string;
  title: string | undefined;
  icon: LucideIcon;
};

/**
 * Links to pages. A click marks its link as active at once, also while the route loads, and the
 * optional guard can hold the navigation.
 */
function SidebarPageLinks({
  links,
  label,
  iconOnly,
  className,
  linkClassName,
  activeClassName,
  onBeforeNavigate,
}: {
  links: readonly SidebarPageLink[];
  label: string;
  iconOnly: boolean;
  className?: string;
  linkClassName: string;
  activeClassName: string;
  onBeforeNavigate: SidebarNavigationProps["onBeforeNavigate"];
}): ReactElement {
  const location = useLocation();
  const navigate = useNavigate();

  const currentPathname = location.pathname;
  const currentLocationKey = location.key;
  const [navigationState, setNavigationState] = useState<SidebarNavigationState>(() => ({
    activatedRoute: null,
    committedLocationKey: currentLocationKey,
  }));
  let activatedRoute = navigationState.activatedRoute;

  if (navigationState.committedLocationKey !== currentLocationKey) {
    // Reset during render so restored history entries cannot revive stale optimistic feedback.
    activatedRoute = null;
    setNavigationState({ activatedRoute: null, committedLocationKey: currentLocationKey });
  }

  const activateRoute = (route: string, event: MouseEvent<HTMLAnchorElement>): void => {
    if (!shouldActivateSidebarNavigation(currentPathname, route, event)) {
      return;
    }
    setNavigationState({ activatedRoute: route, committedLocationKey: currentLocationKey });
    if (onBeforeNavigate) {
      event.preventDefault();
      onBeforeNavigate(
        () => navigate(route),
        () =>
          setNavigationState({ activatedRoute: null, committedLocationKey: currentLocationKey }),
      );
    }
  };

  return (
    <nav aria-label={label} className={className}>
      {links.map(({ route, label: linkLabel, title, icon: Icon }) => (
        <NavLink
          key={route}
          to={route}
          title={title}
          aria-label={linkLabel}
          onClick={(event) => activateRoute(route, event)}
          className={({ isActive }) =>
            cn(
              "flex cursor-pointer items-center rounded-md text-sm font-medium",
              linkClassName,
              (activatedRoute === null ? isActive : activatedRoute === route)
                ? activeClassName
                : "text-sidebar-foreground hover:bg-accent hover:text-accent-foreground",
            )
          }
        >
          <Icon className="size-4" />
          {iconOnly ? null : linkLabel}
        </NavLink>
      ))}
    </nav>
  );
}

/** The Kanban link. Sessions have their own list, so the sidebar keeps no page links for them. */
export function SidebarNavigation({
  compact = false,
  onBeforeNavigate,
}: SidebarNavigationProps): ReactElement {
  const kanbanTitle = useShortcutTitle("kanban", "Kanban");
  return (
    <SidebarPageLinks
      label="Pages"
      links={[{ route: KANBAN_ROUTE, label: "Kanban", title: kanbanTitle, icon: Columns3 }]}
      iconOnly={compact}
      linkClassName={compact ? "size-9 justify-center" : "h-9 gap-2 px-3"}
      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
      onBeforeNavigate={onBeforeNavigate}
    />
  );
}

/** The icon links of the expanded sidebar footer, beside Settings. The collapsed sidebar has none. */
export function SidebarFooterLinks({
  onBeforeNavigate,
}: Pick<SidebarNavigationProps, "onBeforeNavigate">): ReactElement {
  const usageTitle = useShortcutTitle("usage", "Usage");
  const workflowsTitle = useShortcutTitle("workflows", "Workflows");
  return (
    <SidebarPageLinks
      label="More pages"
      links={[
        { route: USAGE_PATH, label: "Usage", title: usageTitle, icon: ChartSpline },
        { route: WORKFLOWS_ROUTE, label: "Workflows", title: workflowsTitle, icon: Workflow },
      ]}
      iconOnly
      className="flex items-center gap-1"
      linkClassName="size-9 justify-center"
      // A quiet tile beside the icon buttons of the footer.
      activeClassName="bg-accent text-accent-foreground ring-1 ring-border"
      onBeforeNavigate={onBeforeNavigate}
    />
  );
}
