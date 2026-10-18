import { Check, type LucideIcon } from "lucide-react";
import { type ReactElement, type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
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

export type KanbanFilterOption<Value> = { value: Value; label: string; icon?: ReactNode };

type KanbanFilterMenuProps<Value extends string | number> = {
  name: string;
  icon: LucideIcon;
  options: readonly KanbanFilterOption<Value>[];
  selected: readonly Value[];
  disabled: boolean;
  /** A text field that narrows the list, and the text when no value matches. */
  search?: { placeholder: string; emptyText: string };
  onSelectedChange: (selected: Value[]) => void;
};

/**
 * A board filter button with a list of values. Each selection toggles one value and keeps the
 * list open, so the user can select several values in one step.
 */
export function KanbanFilterMenu<Value extends string | number>({
  name,
  icon: Icon,
  options,
  selected,
  disabled,
  search,
  onSelectedChange,
}: KanbanFilterMenuProps<Value>): ReactElement {
  const [query, setQuery] = useState("");
  const checked = new Set(selected);
  const term = query.trim().toLowerCase();
  const visibleOptions = term
    ? options.filter((option) => option.label.toLowerCase().includes(term))
    : options;
  const selection = selectionText(name, options, selected);
  const toggle = (value: Value): void => {
    onSelectedChange(
      checked.has(value) ? selected.filter((entry) => entry !== value) : [...selected, value],
    );
  };

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("max-w-64 gap-1.5 px-2.5", selection === null && "border-dashed")}
          aria-label={selection === null ? undefined : `${name}: ${selection}`}
          disabled={disabled}
        >
          <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
          {name}
          {selection === null ? null : (
            <>
              <span aria-hidden="true" className="h-4 w-px bg-border" />
              <Badge
                variant="secondary"
                className="block max-w-32 truncate rounded-sm px-1.5 font-normal"
              >
                {selection}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command shouldFilter={false} label={name}>
          <CommandInput
            visuallyHidden={!search}
            placeholder={search?.placeholder}
            value={query}
            onValueChange={search ? setQuery : () => {}}
          />
          {/* cmdk marks the highlighted option as selected, so the checked state uses aria-checked
              and the list stays single-select for assistive technology. */}
          <CommandList label={name}>
            {search ? <CommandEmpty>{search.emptyText}</CommandEmpty> : null}
            <CommandGroup>
              {visibleOptions.map((option) => {
                const isChecked = checked.has(option.value);
                return (
                  <CommandItem
                    key={String(option.value)}
                    value={String(option.value)}
                    aria-checked={isChecked}
                    onSelect={() => toggle(option.value)}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                        isChecked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input",
                      )}
                    >
                      {isChecked ? <Check className="size-3" /> : null}
                    </span>
                    {option.icon}
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The one selected value, the count of selected values, or null without a selection. */
const selectionText = <Value,>(
  name: string,
  options: readonly KanbanFilterOption<Value>[],
  selected: readonly Value[],
): string | null => {
  if (selected.length === 0) return null;
  if (selected.length > 1) return String(selected.length);
  const option = options.find((entry) => entry.value === selected[0]);
  if (!option) throw new Error(`The ${name} filter has no option for its selected value.`);
  return option.label;
};
