import { type ReactElement, useId } from "react";
import { FolderPickerContent } from "./folder-picker-content";
import {
  type FolderPickerCommonProps,
  type FolderPickerController,
  useFolderPickerController,
} from "./use-folder-picker-controller";

type InlineFolderPickerOptions = Omit<
  FolderPickerCommonProps,
  "title" | "description" | "confirmLabel"
> & {
  onCancel?: () => void;
};

export function useInlineFolderPickerController({
  initialPath,
  requireGitRepo = false,
  selectionMode = "directory",
  onCancel,
  onConfirm,
}: InlineFolderPickerOptions): FolderPickerController {
  return useFolderPickerController({
    open: true,
    onOpenChange: (open) => {
      if (!open) onCancel?.();
    },
    initialPath,
    requireGitRepo,
    selectionMode,
    onConfirm,
  });
}

export function InlineFolderPickerContent({
  controller,
  title,
  description,
}: {
  controller: FolderPickerController;
  title: string;
  description: string;
}): ReactElement {
  const descriptionId = useId();

  return (
    <section className="grid gap-4" aria-label={title} aria-describedby={descriptionId}>
      <p id={descriptionId} className="sr-only">
        {description}
      </p>
      <FolderPickerContent controller={controller} />
    </section>
  );
}
