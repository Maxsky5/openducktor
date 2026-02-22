import { cva } from "class-variance-authority";
import { Check, ChevronsUpDown } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
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
  searchKeywords?: string[];
  description?: string;
  accentColor?: string;
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
  wrapLabels?: boolean;
  wrapTriggerLabel?: boolean;
  wrapOptionLabels?: boolean;
};

type RenderGroup = {
  key: string;
  label?: string;
  options: ComboboxOption[];
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

const comboboxOptionDescriptionVariants = cva("text-xs text-slate-500", {
  variants: {
    wrap: {
      true: "whitespace-normal break-all",
      false: "truncate",
    },
  },
});

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
  wrapLabels = false,
  wrapTriggerLabel,
  wrapOptionLabels,
}: ComboboxProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  const shouldWrapTriggerLabel = wrapLabels || wrapTriggerLabel === true;
  const shouldWrapOptionLabels = wrapLabels || wrapOptionLabels === true;

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
    if (resolvedGroups) {
      return resolvedGroups.map((group, groupIndex) => ({
        key: `${group.label}:${groupIndex}`,
        label: group.label,
        options: group.options,
      }));
    }

    return [{ key: "__ungrouped__", options }];
  }, [resolvedGroups, options]);

  const renderOptionLabel = (
    option: Pick<ComboboxOption, "accentColor" | "label">,
    shouldWrap: boolean,
    containerClassName?: string,
  ): ReactElement => (
    <span className={cn(comboboxOptionLabelRowVariants({ wrap: shouldWrap }), containerClassName)}>
      {option.accentColor ? (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: option.accentColor }}
        />
      ) : null}
      <span className={comboboxOptionLabelTextVariants({ wrap: shouldWrap })}>{option.label}</span>
    </span>
  );

  const renderOptionItem = (option: ComboboxOption): ReactElement => (
    <CommandItem
      key={option.value}
      value={option.value}
      keywords={[option.label, ...(option.searchKeywords ?? [])]}
      onSelect={() => {
        onValueChange(option.value);
        setOpen(false);
      }}
      className={comboboxOptionItemVariants({ wrap: shouldWrapOptionLabels })}
    >
      <div className="min-w-0 flex-1">
        {renderOptionLabel(option, shouldWrapOptionLabels)}
        {option.description ? (
          <p className={comboboxOptionDescriptionVariants({ wrap: shouldWrapOptionLabels })}>
            {option.description}
          </p>
        ) : null}
      </div>
      {option.secondaryLabel ? (
        <span className="mr-1 shrink-0 text-xs font-medium text-slate-500">
          {option.secondaryLabel}
        </span>
      ) : null}
      <Check
        className={cn(
          "ml-2 size-4 text-sky-600 transition-opacity",
          value === option.value ? "opacity-100" : "opacity-0",
        )}
      />
    </CommandItem>
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
          <span className={comboboxTriggerValueVariants({ wrap: shouldWrapTriggerLabel })}>
            {selected ? renderOptionLabel(selected, shouldWrapTriggerLabel) : placeholder}
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
            {groupsToRender.map((group) => (
              <CommandGroup key={group.key} {...(group.label ? { heading: group.label } : {})}>
                {group.options.map(renderOptionItem)}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
