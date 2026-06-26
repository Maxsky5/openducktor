import { cn } from "@/lib/utils";

type SidebarNavLinkClassNameArgs = {
  compact: boolean;
  isActive: boolean;
  isDisabled: boolean;
  isPending: boolean;
};

export const sidebarNavLinkClassName = ({
  compact,
  isActive,
  isDisabled,
  isPending,
}: SidebarNavLinkClassNameArgs): string => {
  const isSelected = !isDisabled && (isActive || isPending);

  return cn(
    compact
      ? "flex items-center justify-center rounded-lg p-2.5 text-sm font-medium transition"
      : "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
    isDisabled ? "cursor-not-allowed opacity-50" : "",
    isSelected
      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
      : "text-sidebar-foreground hover:bg-accent hover:text-accent-foreground",
  );
};
