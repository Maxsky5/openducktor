import { LoaderCircle, Save } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import {
  resolveSettingsModalFooter,
  type SettingsModalFooterState,
} from "./settings-modal-footer-state";

type SettingsModalFooterProps = SettingsModalFooterState & {
  onCancel: () => void;
  onSave: () => void;
};

export function SettingsModalFooter({
  saveState,
  validationSummary,
  errors,
  location,
  onCancel,
  onSave,
}: SettingsModalFooterProps): ReactElement {
  if (location.section === "remote-access") {
    return (
      <DialogFooter className="mt-0 flex-row items-center justify-start gap-4 border-t border-border px-6 py-4">
        <Button type="button" variant="outline" disabled={saveState.isSaving} onClick={onCancel}>
          Cancel
        </Button>
        <p className="text-xs text-muted-foreground">Remote control changes save immediately.</p>
      </DialogFooter>
    );
  }
  const { isSaveDisabled, messages } = resolveSettingsModalFooter({
    saveState,
    validationSummary,
    errors,
    location,
  });

  return (
    <DialogFooter className="mt-0 flex-col items-stretch gap-2 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex items-center gap-2 [&>button]:w-full sm:[&>button]:w-auto">
        <Button type="button" variant="outline" disabled={saveState.isSaving} onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="-order-2 flex min-w-0 grow flex-col gap-1 text-sm empty:hidden sm:order-none sm:flex-row">
        {messages.map((message) => (
          <span key={message.id} className="whitespace-pre-wrap break-words text-destructive-muted">
            {message.text}
          </span>
        ))}
      </div>

      <div className="-order-1 flex items-center justify-end gap-2 [&>button]:w-full sm:order-none sm:[&>button]:w-auto">
        <Button type="button" disabled={isSaveDisabled} onClick={onSave}>
          {saveState.isSaving ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : (
            <Save data-icon="inline-start" />
          )}
          {saveState.isSaving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </DialogFooter>
  );
}
