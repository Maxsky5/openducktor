import type { NotificationCue } from "@openducktor/contracts";
import type { SoundPickerOption } from "./settings-notification-sound-options";
import { Check, ChevronsUpDown, Volume2, VolumeX } from "lucide-react";
import { type ReactElement, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type NotificationSoundPickerProps<Value extends string> = {
  label: string;
  value: Value;
  options: readonly SoundPickerOption<Value>[];
  disabled: boolean;
  onValueChange: (value: Value) => void;
  onPreview: (cue: NotificationCue) => void;
};

export function NotificationSoundPicker<Value extends string>({
  label,
  value,
  options,
  disabled,
  onValueChange,
  onPreview,
}: NotificationSoundPickerProps<Value>): ReactElement {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  if (!selected) {
    throw new Error(`Sound option "${value}" is not available.`);
  }

  const portalContainer =
    open && globalThis.document !== undefined && document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>("[data-slot='dialog-content']")
      : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="w-full min-w-0 justify-between border-input bg-card px-3 font-normal"
        >
          <span className="truncate">{selected.label}</span>
          <ChevronsUpDown aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        portalContainer={portalContainer}
        align="end"
        aria-label={`${label} menu`}
        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-1"
      >
        <ul className="max-h-72 overflow-y-auto overscroll-contain">
          {options.map((option) => (
            <li key={option.value} className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                aria-pressed={option.value === value}
                className={cn(
                  "h-8 min-w-0 flex-1 justify-start px-2 font-normal",
                  option.value === value && "bg-accent text-accent-foreground",
                )}
                onClick={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
              >
                <Check
                  aria-hidden="true"
                  className={cn(option.value === value ? "opacity-100" : "opacity-0")}
                />
                <span className="truncate">{option.label}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Preview ${option.label}`}
                disabled={option.previewCue === null}
                onClick={() => {
                  if (option.previewCue) {
                    onPreview(option.previewCue);
                  }
                }}
              >
                {option.previewCue ? (
                  <Volume2 aria-hidden="true" />
                ) : (
                  <VolumeX aria-hidden="true" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
