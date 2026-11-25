import type { TaskAssetRenderContext } from "@openducktor/contracts";
import type { ReactElement } from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocumentCopyButton } from "@/components/ui/document-copy-button";
import { type MarkdownImages, MarkdownRenderer } from "@/components/ui/markdown-renderer";

export type MarkdownPreviewModalProps = {
  markdown: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  title?: string;
  stripTaskDescriptionFrontMatter?: boolean;
  taskAssetContext?: Omit<TaskAssetRenderContext, "assetId">;
  images?: MarkdownImages;
};

export function MarkdownPreviewModal({
  markdown,
  open,
  onOpenChange,
  onCloseAutoFocus,
  title,
  stripTaskDescriptionFrontMatter = false,
  taskAssetContext,
  images,
}: MarkdownPreviewModalProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-markdown-preview
        className="flex max-w-5xl flex-col overflow-hidden p-0"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className={title ? "text-xl font-semibold" : "sr-only"}>
            {title ?? "Artifact preview"}
          </DialogTitle>
          <DialogDescription className="sr-only">Read the full artifact.</DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 flex-1 overflow-hidden">
          <div className="relative max-h-[calc(100dvh-12rem)] overflow-y-auto px-6 pt-4 pb-6">
            <MarkdownRenderer
              markdown={markdown}
              variant="document"
              stripTaskDescriptionFrontMatter={stripTaskDescriptionFrontMatter}
              {...(taskAssetContext ? { taskAssetContext } : {})}
              {...(images ? { images } : {})}
            />
            <DocumentCopyButton
              markdown={markdown}
              dataTestId="markdown-preview-modal-copy"
              errorLogContext="MarkdownPreviewModal"
              className="absolute top-4 right-6 z-10"
            />
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
