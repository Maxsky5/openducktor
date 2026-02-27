import { Bot, Columns3 } from "lucide-react";
import type { ReactElement } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { to: "/kanban", icon: Columns3, label: "Kanban", requiresRepo: false },
  { to: "/agents", icon: Bot, label: "Agents", requiresRepo: true },
] as const;

type SidebarNavigationProps = {
  hasActiveRepo: boolean;
  compact?: boolean;
};

export function SidebarNavigation({
  hasActiveRepo,
  compact = false,
}: SidebarNavigationProps): ReactElement {
  return (
    <nav className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isDisabled = item.requiresRepo && !hasActiveRepo;
        return (
          <NavLink
            key={item.to}
            to={isDisabled ? "/kanban" : item.to}
            title={item.label}
            aria-label={item.label}
            className={({ isActive }) =>
              cn(
                compact
                  ? "flex items-center justify-center rounded-lg p-2.5 text-sm font-medium transition"
                  : "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition animate-rise-in",
                isDisabled ? "cursor-not-allowed opacity-50" : "",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                  : "text-sidebar-foreground hover:bg-accent hover:text-accent-foreground",
              )
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
