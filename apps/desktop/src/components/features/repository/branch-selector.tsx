import { GitBranch as GitBranchIcon } from "lucide-react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";

type BranchSelectorProps = {
  value: string;
  options: ComboboxOption[];
  onValueChange: (branchName: string) => void;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  popoverClassName?: string;
  triggerClassName?: string;
  wrapOptionLabels?: boolean;
};

export function BranchSelector({
  value,
  options,
  onValueChange,
  disabled = false,
  placeholder = "Select branch...",
  searchPlaceholder = "Search branch...",
  emptyText = "No branch found.",
  className,
  popoverClassName,
  triggerClassName,
  wrapOptionLabels = true,
}: BranchSelectorProps) {
  return (
    <div className={cn("relative", className)}>
      <GitBranchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Combobox
        value={value}
        options={options}
        disabled={disabled}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        emptyText={emptyText}
        wrapOptionLabels={wrapOptionLabels}
        triggerClassName={cn(
          "h-9 w-full rounded-md border-input bg-card pl-8 pr-3 text-sm text-foreground",
          triggerClassName,
        )}
        onValueChange={onValueChange}
        {...(popoverClassName !== undefined ? { className: popoverClassName } : {})}
      />
    </div>
  );
}
