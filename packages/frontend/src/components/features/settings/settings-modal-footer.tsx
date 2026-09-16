import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
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
  const { isSaveDisabled, messages } = resolveSettingsModalFooter({
    saveState,
    validationSummary,
    errors,
    location,
  });

  return (
    <div className="mt-0 flex shrink-0 items-center justify-start border-t border-border px-6 pb-4 pt-4">
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" disabled={saveState.isSaving} onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="flex grow items-center gap-2 text-sm">
        {messages.map((message) => (
          <span key={message.id} className="whitespace-pre-wrap break-words text-destructive-muted">
            {message.text}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" disabled={isSaveDisabled} onClick={onSave}>
          {saveState.isSaving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
