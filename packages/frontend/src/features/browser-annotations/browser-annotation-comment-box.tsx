import { LoaderCircle } from "lucide-react";
import { type KeyboardEvent, type ReactElement, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { cn } from "@/lib/utils";
import type { BrowserAnnotationChanges } from "./browser-annotation-store";

export type BrowserAnnotationCommentBoxProps = {
  /** `edit` changes a pending annotation. `create` saves a new selection. */
  mode: "create" | "edit";
  /** The selected element name, or the number of selected elements. */
  targetLabel: string;
  initialComment?: string;
  initialIncludeScreenshot?: boolean;
  /** A rejected promise keeps the box open and shows the error. */
  onSave: (value: BrowserAnnotationChanges) => void | Promise<void>;
  onCancel: () => void;
  className?: string;
};

/** Comment box for a browser annotation. Save stays disabled until the comment has text. */
export function BrowserAnnotationCommentBox({
  mode,
  targetLabel,
  initialComment = "",
  initialIncludeScreenshot = true,
  onSave,
  onCancel,
  className,
}: BrowserAnnotationCommentBoxProps): ReactElement {
  const [comment, setComment] = useState(initialComment);
  const [includeScreenshot, setIncludeScreenshot] = useState(initialIncludeScreenshot);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const errorId = useId();
  const canSave = comment.trim().length > 0 && !isSaving;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setError(null);
    setIsSaving(true);
    try {
      await onSave({ comment, includeScreenshot });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Escape") {
      // Escape closes only this box. The picker keeps running.
      event.stopPropagation();
      event.preventDefault();
      if (!isSaving) onCancel();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void save();
    }
  };

  return (
    <form
      aria-label={mode === "edit" ? "Edit annotation" : "New annotation"}
      className={cn(
        "flex w-80 max-w-full flex-col gap-2 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-lg",
        className,
      )}
      data-testid="browser-annotation-comment-box"
      onKeyDown={handleKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="truncate text-xs font-medium text-muted-foreground" title={targetLabel}>
        {targetLabel}
      </p>
      <Textarea
        ref={textareaRef}
        aria-label="Annotation comment"
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        className="min-h-20 resize-y"
        disabled={isSaving}
        placeholder="Tell the agent what to change"
        rows={3}
        value={comment}
        onChange={(event) => setComment(event.currentTarget.value)}
      />
      {error ? (
        <p id={errorId} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground has-disabled:cursor-default"
          title="Send the screenshot of the element with the annotation"
        >
          <Switch
            checked={includeScreenshot}
            disabled={isSaving}
            onCheckedChange={setIncludeScreenshot}
          />
          Screenshot
        </label>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" disabled={isSaving} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!canSave}>
            {isSaving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}
