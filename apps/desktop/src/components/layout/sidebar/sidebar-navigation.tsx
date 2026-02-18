import { cn } from "@/lib/utils";
import { Bot, Columns3 } from "lucide-react";
import type { ReactElement } from "react";
import { NavLink } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/kanban", icon: Columns3, label: "Kanban", requiresRepo: false },
  { to: "/agents", icon: Bot, label: "Agents", requiresRepo: true },
] as const;

type SidebarNavigationProps = {
  hasActiveRepo: boolean;
};

export function SidebarNavigation({ hasActiveRepo }: SidebarNavigationProps): ReactElement {
  return (
    <nav className="space-y-1">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isDisabled = item.requiresRepo && !hasActiveRepo;
        return (
          <NavLink
            key={item.to}
            to={isDisabled ? "/kanban" : item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition animate-rise-in",
                isDisabled ? "cursor-not-allowed opacity-50" : "",
                isActive
                  ? "bg-gradient-to-r from-slate-900 to-slate-700 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
              )
            }
            aria-disabled={isDisabled}
          >
            <Icon className="size-4" />
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
