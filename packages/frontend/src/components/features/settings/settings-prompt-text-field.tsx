import type { AgentPromptPlaceholder } from "@openducktor/contracts";
import { type ReactElement, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type PromptTextFieldProps = {
  id: string;
  value: string;
  rows: number;
  placeholder?: string;
  disabled: boolean;
  /** Focus the text when the field mounts, such as after the user asks for a replacement. */
  autoFocus?: boolean;
  /** The placeholders that the prompt can fill. Each one has a button that inserts it. */
  placeholders: readonly AgentPromptPlaceholder[];
  error: string | undefined;
  onChange: (value: string) => void;
};

/** A prompt text editor with buttons that insert the placeholders of the prompt at the caret. */
export function PromptTextField({
  id,
  value,
  rows,
  placeholder,
  disabled,
  autoFocus = false,
  placeholders,
  error,
  onChange,
}: PromptTextFieldProps): ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The caret and the scroll after an insert. The text changes first, so they move after render.
  // A new value scrolls the textarea to its end, so the insert keeps the scroll of the user.
  const pendingInsertRef = useRef<{ caret: number; scrollTop: number } | null>(null);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const pending = pendingInsertRef.current;
    if (!textarea || pending === null) return;
    pendingInsertRef.current = null;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(pending.caret, pending.caret);
    textarea.scrollTop = pending.scrollTop;
  }, [value]);

  const insert = (name: AgentPromptPlaceholder): void => {
    const token = `{{${name}}}`;
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    pendingInsertRef.current = { caret: start + token.length, scrollTop: textarea?.scrollTop ?? 0 };
    onChange(`${value.slice(0, start)}${token}${value.slice(end)}`);
  };
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        ref={textareaRef}
        id={id}
        value={value}
        rows={rows}
        placeholder={placeholder}
        className="font-mono text-xs"
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {error ? (
        <p id={errorId} className="text-xs text-destructive-muted">
          {error}
        </p>
      ) : null}
      <div
        className="flex flex-wrap items-center gap-1"
        role="group"
        aria-label="Insert placeholder"
      >
        <span className="mr-1 text-xs text-muted-foreground">Insert a placeholder</span>
        {placeholders.map((name) => (
          <Button
            key={name}
            type="button"
            size="xs"
            variant="outline"
            disabled={disabled}
            title={`Insert {{${name}}}`}
            className="font-mono font-normal text-muted-foreground hover:text-foreground"
            onClick={() => insert(name)}
          >
            {name}
          </Button>
        ))}
      </div>
    </div>
  );
}
