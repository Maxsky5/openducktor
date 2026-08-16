import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import type { FolderPickerController } from "./use-folder-picker-controller";

export function FolderPickerCancelAction({
  controller,
}: {
  controller: FolderPickerController;
}): ReactElement {
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={controller.isSubmitting}
      onClick={controller.close}
    >
      Cancel
    </Button>
  );
}

export function FolderPickerConfirmAction({
  controller,
  confirmLabel,
}: {
  controller: FolderPickerController;
  confirmLabel: string;
}): ReactElement {
  return (
    <Button
      type="button"
      disabled={!controller.isCurrentPathSelectable || controller.isSubmitting}
      onClick={() => void controller.confirm()}
    >
      {controller.isSubmitting ? "Confirming..." : confirmLabel}
    </Button>
  );
}
