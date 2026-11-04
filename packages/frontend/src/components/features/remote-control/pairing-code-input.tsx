import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
  type RefObject,
} from "react";
import {
  CODE_SLOTS,
  sanitizePairingCode,
  selectionAfterEdit,
  selectionForTap,
  slotIsActive,
  type CodeSelection,
} from "@openducktor/frontend-core/lib/pairing-code-selection";
import { cn } from "@/lib/utils";

type PairingCodeInputProps = Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "type" | "ref"
> & {
  value: string;
  onChange(value: string): void;
  ref?: RefObject<HTMLInputElement | null>;
};

/**
 * Six visible digit slots over one real field, so typing, paste, and autofill all work. A click on
 * a digit selects it, so the next digit replaces it.
 */
export function PairingCodeInput({
  value,
  onChange,
  className,
  ref,
  ...props
}: PairingCodeInputProps) {
  const ownRef = useRef<HTMLInputElement | null>(null);
  const input = ref ?? ownRef;
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState<CodeSelection>({
    start: value.length,
    end: value.length,
  });
  const select = (field: HTMLInputElement, next: CodeSelection) => {
    field.setSelectionRange(next.start, next.end);
    setSelection(next);
  };
  // A replaced digit moves the selection to the next digit, so a correction reads left to right.
  const nextSelection = useRef<CodeSelection | null>(null);
  useLayoutEffect(() => {
    const field = input.current;
    const next = nextSelection.current;
    if (!field || next === null) return;
    nextSelection.current = null;
    select(field, next);
  });
  const slots = useRef<HTMLDivElement>(null);
  // The field covers the slots, so a click lands on it. The click position picks the slot.
  const choose = (event: MouseEvent<HTMLInputElement>) => {
    const field = event.currentTarget;
    if (props.disabled) return;
    event.preventDefault();
    field.focus();
    const boxes = [...(slots.current?.querySelectorAll("[data-code-slot]") ?? [])];
    const slotEnds = boxes.map((box) => box.getBoundingClientRect().right);
    select(field, selectionForTap(slotEnds, event.clientX, field.value));
  };
  const invalid = props["aria-invalid"] === true || props["aria-invalid"] === "true";
  const active = (position: number) => focused && slotIsActive(selection, position);
  const slot = (position: number) => (
    <span
      key={position}
      data-code-slot={position}
      className={cn(
        "flex h-14 min-w-0 flex-1 items-center justify-center rounded-md border bg-card font-mono text-2xl font-medium text-foreground shadow-xs transition-colors",
        invalid ? "border-destructive-border" : "border-input",
        active(position) && "border-ring",
        active(position) && selection.start !== selection.end && "bg-muted",
      )}
    >
      {value[position] ??
        (active(position) ? <span className="h-6 w-px animate-pulse bg-foreground" /> : null)}
    </span>
  );
  return (
    <div className={cn("relative w-full max-w-sm", props.disabled && "opacity-60", className)}>
      <input
        {...props}
        ref={input}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          const next = sanitizePairingCode(event.target.value);
          // The browser places the caret after typing or deleting. A replacement selects the next digit.
          if (next.length === value.length && next !== value)
            nextSelection.current = selectionAfterEdit(value, next);
          onChange(next);
        }}
        onSelect={(event) =>
          setSelection({
            start: event.currentTarget.selectionStart ?? value.length,
            end: event.currentTarget.selectionEnd ?? value.length,
          })
        }
        onMouseDown={choose}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        className="absolute inset-0 z-1 size-full cursor-text opacity-0 disabled:cursor-not-allowed"
      />
      <div ref={slots} aria-hidden="true" className="flex items-center gap-2">
        {CODE_SLOTS.slice(0, 3).map(slot)}
        <span className="h-0.5 w-3 shrink-0 rounded-full bg-border" />
        {CODE_SLOTS.slice(3).map(slot)}
      </div>
    </div>
  );
}
