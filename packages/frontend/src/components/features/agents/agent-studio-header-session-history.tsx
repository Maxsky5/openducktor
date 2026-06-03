import { Check, History } from "lucide-react";
import { type ReactElement, useMemo, useRef, useState } from "react";
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
import type { AgentStudioSessionSelectorModel } from "./agent-studio-header.types";
import { deriveSessionHistorySelectionFocusBehavior } from "./agent-studio-header-session-history-model";

type SessionHistoryMenuProps = {
  selector: AgentStudioSessionSelectorModel;
  agentStudioReady: boolean;
};

export function SessionHistoryMenu({
  selector,
  agentStudioReady,
}: SessionHistoryMenuProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const preventTriggerRefocusRef = useRef(false);
  const restoreTriggerFocusRef = useRef(false);

  const groupsWithOptions = useMemo(
    () => selector.groups.filter((group) => group.options.length > 0),
    [selector.groups],
  );
  const selectedOption = useMemo(() => {
    for (const group of groupsWithOptions) {
      for (const option of group.options) {
        if (option.value === selector.value) {
          return option;
        }
      }
    }
    return null;
  }, [groupsWithOptions, selector.value]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          size="icon"
          className="size-9 rounded-md"
          disabled={selector.disabled || !agentStudioReady}
          title={selectedOption ? `Session history · ${selectedOption.label}` : "Session history"}
          aria-label={
            selectedOption ? `Session history, selected ${selectedOption.label}` : "Session history"
          }
        >
          <History className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        onCloseAutoFocus={(event) => {
          if (!preventTriggerRefocusRef.current) {
            if (!restoreTriggerFocusRef.current) {
              return;
            }

            restoreTriggerFocusRef.current = false;
            event.preventDefault();
            const requestAnimationFrameFn = globalThis.requestAnimationFrame;
            if (typeof requestAnimationFrameFn === "function") {
              requestAnimationFrameFn(() => {
                triggerRef.current?.focus();
              });
              return;
            }

            triggerRef.current?.focus();
            return;
          }

          preventTriggerRefocusRef.current = false;
          event.preventDefault();
        }}
      >
        <Command>
          <CommandInput placeholder="Search sessions…" className="h-8 text-sm" />
          <CommandList>
            <CommandEmpty>No sessions available.</CommandEmpty>
            {groupsWithOptions.map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                {group.options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${group.label} ${option.label} ${option.description ?? ""}`}
                    onSelect={() => {
                      if (option.value === selector.value) {
                        setIsOpen(false);
                        return;
                      }

                      const focusBehavior = deriveSessionHistorySelectionFocusBehavior({
                        currentValue: selector.value,
                        nextValue: option.value,
                        shouldAutofocusComposerForValue: selector.shouldAutofocusComposerForValue,
                      });
                      preventTriggerRefocusRef.current = focusBehavior === "composer";
                      restoreTriggerFocusRef.current = focusBehavior === "trigger";
                      selector.onValueChange(option.value);
                      setIsOpen(false);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{option.label}</p>
                      {option.description ? (
                        <p className="truncate text-[11px] text-muted-foreground">
                          {option.description}
                        </p>
                      ) : null}
                    </div>
                    {selector.value === option.value ? (
                      <Check className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
