import type { WorkspaceRecord } from "@openducktor/contracts";
import { useMemo } from "react";
import { Combobox } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { toRepositorySelectorOptions } from "./repository-selector-model";

type RepositorySelectorProps = {
  workspaces: WorkspaceRecord[];
  value: string;
  onValueChange: (workspaceId: string) => void;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  errorCountByWorkspaceId?: Partial<Record<string, number>>;
};

export function RepositorySelector({
  workspaces,
  value,
  onValueChange,
  disabled = false,
  className,
  triggerClassName,
  placeholder = "Select repository",
  searchPlaceholder = "Search repository...",
  errorCountByWorkspaceId,
}: RepositorySelectorProps) {
  const options = useMemo(
    () => toRepositorySelectorOptions(workspaces, errorCountByWorkspaceId),
    [errorCountByWorkspaceId, workspaces],
  );

  if (options.length === 0) {
    return null;
  }

  return (
    <div className={cn("min-w-0", className)}>
      <Combobox
        value={value}
        options={options}
        disabled={disabled}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        onValueChange={onValueChange}
        triggerClassName={cn(
          "h-9 w-full rounded-md border-input bg-card px-3 text-sm text-foreground",
          triggerClassName,
        )}
      />
    </div>
  );
}
