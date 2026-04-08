import { cva } from "class-variance-authority";
import { Check, ChevronsUpDown } from "lucide-react";
import { type ReactElement, type ReactNode, useMemo, useRef, useState } from "react";
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

export type ComboboxOption = {
  value: string;
  label: string;
  searchText?: string;
  searchKeywords?: string[];
  description?: string;
  accentColor?: string;
  icon?: ReactNode;
  secondaryLabel?: string;
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
  triggerAriaLabelledBy?: string;
  wrapLabels?: boolean;
  wrapTriggerLabel?: boolean;
  wrapOptionLabels?: boolean;
  matchAllSearchTerms?: boolean;
};

type RenderGroup = {
  key: string;
  label?: string;
  options: ComboboxOption[];
};

type ComboboxOptionLabelProps = {
  option: Pick<ComboboxOption, "accentColor" | "icon" | "label">;
  shouldWrap: boolean;
  containerClassName?: string;
};

type ComboboxOptionItemProps = {
  option: ComboboxOption;
  value: string;
  shouldWrapOptionLabels: boolean;
  onValueChange: (value: string) => void;
  onSelectComplete: () => void;
};

const comboboxTriggerValueVariants = cva("min-w-0 flex-1 pr-2 text-left", {
  variants: {
    wrap: {
      true: "whitespace-normal break-all leading-snug",
      false: "truncate",
    },
  },
});

const comboboxOptionItemVariants = cva("justify-between", {
  variants: {
    wrap: {
      true: "items-start",
      false: "",
    },
  },
});

const comboboxOptionLabelRowVariants = cva("inline-flex min-w-0 items-center gap-2", {
  variants: {
    wrap: {
      true: "whitespace-normal break-all",
      false: "truncate",
    },
  },
});

const comboboxOptionLabelTextVariants = cva("", {
  variants: {
    wrap: {
      true: "whitespace-normal break-all",
      false: "truncate",
    },
  },
});

const comboboxOptionDescriptionVariants = cva("text-xs text-muted-foreground", {
  variants: {
    wrap: {
      true: "whitespace-normal break-all",
      false: "truncate",
    },
  },
});

const normalizeSearchTerms = (query: string): string[] => {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
};

const getOptionSearchText = (option: ComboboxOption): string => {
  return (
    option.searchText ?? [option.label, ...(option.searchKeywords ?? [])].join(" ")
  ).toLowerCase();
};

const matchesAllTerms = (option: ComboboxOption, searchTerms: string[]): boolean => {
  if (searchTerms.length === 0) {
    return true;
  }

  const searchText = getOptionSearchText(option);
  return searchTerms.every((term) => searchText.includes(term));
};

function ComboboxOptionLabel({
  option,
  shouldWrap,
  containerClassName,
}: ComboboxOptionLabelProps): ReactElement {
  return (
    <span className={cn(comboboxOptionLabelRowVariants({ wrap: shouldWrap }), containerClassName)}>
      {option.icon ? <span className="shrink-0 text-muted-foreground">{option.icon}</span> : null}
      {option.accentColor ? (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: option.accentColor }}
        />
      ) : null}
      <span className={comboboxOptionLabelTextVariants({ wrap: shouldWrap })}>{option.label}</span>
    </span>
  );
}

function ComboboxOptionItem({
  option,
  value,
  shouldWrapOptionLabels,
  onValueChange,
  onSelectComplete,
}: ComboboxOptionItemProps): ReactElement {
  return (
    <CommandItem
      value={option.value}
      keywords={[option.label, ...(option.searchKeywords ?? [])]}
      onSelect={() => {
        onValueChange(option.value);
        onSelectComplete();
      }}
      className={comboboxOptionItemVariants({ wrap: shouldWrapOptionLabels })}
    >
      <div className="min-w-0 flex-1">
        <ComboboxOptionLabel option={option} shouldWrap={shouldWrapOptionLabels} />
        {option.description ? (
          <p className={comboboxOptionDescriptionVariants({ wrap: shouldWrapOptionLabels })}>
            {option.description}
          </p>
        ) : null}
      </div>
      {option.secondaryLabel ? (
        <span className="mr-1 shrink-0 text-xs font-medium text-muted-foreground">
          {option.secondaryLabel}
        </span>
      ) : null}
      <Check
        className={cn(
          "ml-2 size-4 text-primary transition-opacity",
          value === option.value ? "opacity-100" : "opacity-0",
        )}
      />
    </CommandItem>
  );
}

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
  triggerAriaLabelledBy,
  wrapLabels = false,
  wrapTriggerLabel,
  wrapOptionLabels,
  matchAllSearchTerms = false,
}: ComboboxProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const commandListRef = useRef<HTMLDivElement | null>(null);

  const shouldWrapTriggerLabel = wrapLabels || wrapTriggerLabel === true;
  const shouldWrapOptionLabels = wrapLabels || wrapOptionLabels === true;
  const searchTerms = useMemo(() => normalizeSearchTerms(searchQuery), [searchQuery]);
  const portalContainer =
    open && typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>("[data-slot='dialog-content']")
      : null;

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

  const groupsToRender = useMemo<RenderGroup[]>(() => {
    if (matchAllSearchTerms) {
      if (resolvedGroups) {
        return resolvedGroups
          .map((group, groupIndex) => ({
            key: `${group.label}:${groupIndex}`,
            label: group.label,
            options: group.options.filter((option) => matchesAllTerms(option, searchTerms)),
          }))
          .filter((group) => group.options.length > 0);
      }

      return [
        {
          key: "__ungrouped__",
          options: resolvedOptions.filter((option) => matchesAllTerms(option, searchTerms)),
        },
      ];
    }

    if (resolvedGroups) {
      return resolvedGroups.map((group, groupIndex) => ({
        key: `${group.label}:${groupIndex}`,
        label: group.label,
        options: group.options,
      }));
    }

    return [{ key: "__ungrouped__", options: resolvedOptions }];
  }, [matchAllSearchTerms, resolvedGroups, resolvedOptions, searchTerms]);

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchQuery("");
    }
  };

  const handleSearchQueryChange = (nextQuery: string): void => {
    const list = commandListRef.current;
    if (open && list && list.scrollTop !== 0) {
      list.scrollTop = 0;
    }

    setSearchQuery(nextQuery);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-labelledby={triggerAriaLabelledBy}
          className={cn(
            "h-9 w-full min-w-0 justify-between border-input bg-card px-3 font-normal text-foreground hover:bg-accent",
            triggerClassName,
          )}
        >
          <span className={comboboxTriggerValueVariants({ wrap: shouldWrapTriggerLabel })}>
            {selected ? (
              <ComboboxOptionLabel option={selected} shouldWrap={shouldWrapTriggerLabel} />
            ) : (
              placeholder
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        portalContainer={portalContainer}
        className={cn("w-[var(--radix-popover-trigger-width)] p-0", className)}
      >
        <Command shouldFilter={!matchAllSearchTerms}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={searchQuery}
            onValueChange={handleSearchQueryChange}
          />
          <CommandList ref={commandListRef}>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {groupsToRender.map((group) => (
              <CommandGroup key={group.key} {...(group.label ? { heading: group.label } : {})}>
                {group.options.map((option) => (
                  <ComboboxOptionItem
                    key={option.value}
                    option={option}
                    value={value}
                    shouldWrapOptionLabels={shouldWrapOptionLabels}
                    onValueChange={onValueChange}
                    onSelectComplete={() => handleOpenChange(false)}
                  />
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
