import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";

export type ComboboxOption = {
  value: string;
  label: string;
  searchKeywords?: string[];
  description?: string;
};

export type ComboboxGroup = {
  label: string;
  options: ComboboxOption[];
};

type ComboboxProps = {
  value: string;
  onValueChange: (value: string) => void;
  options: ComboboxOption[];
  groups?: ComboboxGroup[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
};

export function Combobox({
  value,
  onValueChange,
  options,
  groups,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No option found.",
  disabled = false,
  className,
  triggerClassName,
}: ComboboxProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  const resolvedOptions = useMemo(() => {
    if (!groups || groups.length === 0) {
      return options;
    }
    return groups.flatMap((group) => group.options);
  }, [groups, options]);

  const resolvedGroups = useMemo(() => {
    if (!groups || groups.length === 0) {
      return null;
    }
    return groups.filter((group) => group.options.length > 0);
  }, [groups]);

  const selected = useMemo(
    () => resolvedOptions.find((option) => option.value === value) ?? null,
    [resolvedOptions, value],
  );

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      setPortalContainer(null);
      return;
    }

    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) {
      setPortalContainer(null);
      return;
    }

    setPortalContainer(active.closest<HTMLElement>("[data-slot='dialog-content']"));
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-9 w-full min-w-0 justify-between border-slate-300 bg-white px-3 font-normal text-slate-900 hover:bg-slate-50",
            triggerClassName,
          )}
        >
          <span className="min-w-0 flex-1 truncate pr-2 text-left">
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        portalContainer={portalContainer}
        className={cn("w-[var(--radix-popover-trigger-width)] p-0", className)}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {resolvedGroups ? (
              resolvedGroups.map((group, groupIndex) => (
                <CommandGroup key={`${group.label}:${groupIndex}`} heading={group.label}>
                  {group.options.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      keywords={[option.label, ...(option.searchKeywords ?? [])]}
                      onSelect={() => {
                        onValueChange(option.value);
                        setOpen(false);
                      }}
                      className="justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate">{option.label}</p>
                        {option.description ? (
                          <p className="truncate text-xs text-slate-500">{option.description}</p>
                        ) : null}
                      </div>
                      <Check
                        className={cn(
                          "ml-2 size-4 text-sky-600 transition-opacity",
                          value === option.value ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))
            ) : (
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label, ...(option.searchKeywords ?? [])]}
                    onSelect={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                    className="justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate">{option.label}</p>
                      {option.description ? (
                        <p className="truncate text-xs text-slate-500">{option.description}</p>
                      ) : null}
                    </div>
                    <Check
                      className={cn(
                        "ml-2 size-4 text-sky-600 transition-opacity",
                        value === option.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
