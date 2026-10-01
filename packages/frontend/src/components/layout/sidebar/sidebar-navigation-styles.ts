import { cn } from "@/lib/utils";

type SidebarNavLinkClassNameArgs = {
  compact: boolean;
  isActive: boolean;
  isActivated: boolean;
};

export const sidebarNavLinkClassName = ({
  compact,
  isActive,
  isActivated,
}: SidebarNavLinkClassNameArgs): string =>
  cn(
    "cursor-pointer",
    compact
      ? "flex items-center justify-center rounded-lg p-2.5 text-sm font-medium"
      : "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
    isActive || isActivated
      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
      : "text-sidebar-foreground hover:bg-accent hover:text-accent-foreground",
  );
