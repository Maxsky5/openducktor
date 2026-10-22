import { FileUp, LoaderCircle } from "lucide-react";
import { type ReactElement, useId } from "react";
import { Button } from "@/components/ui/button";
import type { BrowserPromptOf } from "./browser-component-types";

export type BrowserFileChooserBarProps = {
  prompt: BrowserPromptOf<"file_chooser">;
  /** True while the OS dialog is open or the page gets the files. */
  busy: boolean;
  error: string | null;
  /** Leaves the file input of the page unchanged. */
  onCancel: () => void;
  /** Opens the OS file dialog. */
  onChooseFiles: () => void;
};

/** Lets the user answer a file chooser of the page. */
export function BrowserFileChooserBar({
  prompt,
  busy,
  error,
  onCancel,
  onChooseFiles,
}: BrowserFileChooserBarProps): ReactElement {
  const textId = useId();
  const chooseLabel = prompt.multiple ? "Choose files" : "Choose a file";

  return (
    <section
      aria-labelledby={textId}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-info-border/60 bg-info-surface px-3 py-2 text-info-surface-foreground"
    >
      <FileUp className="size-4 shrink-0" aria-hidden="true" />
      <div className="flex min-w-48 flex-1 flex-col gap-0.5">
        <p id={textId} className="text-sm">
          {chooserText(prompt)}
        </p>
        {prompt.accept.length > 0 ? (
          <p className="text-xs break-all opacity-80">Allowed types: {prompt.accept.join(", ")}</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={busy} onClick={onChooseFiles}>
          {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
          {chooseLabel}
        </Button>
      </div>
    </section>
  );
}

const chooserText = (prompt: BrowserPromptOf<"file_chooser">): string => {
  const files = prompt.multiple ? "files" : "a file";
  if (prompt.startedByAgent) {
    return `An agent action opened a file chooser. Agents cannot choose files, so choose ${files} for the page or cancel.`;
  }
  return `The page asks for ${files}.`;
};
