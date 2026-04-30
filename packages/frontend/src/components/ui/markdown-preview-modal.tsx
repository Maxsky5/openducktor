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
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { hasLabeledCodeFence } from "@/lib/markdown-utils";

export type MarkdownPreviewModalProps = {
  markdown: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display title shown in the modal header. Enrichted with task context by callers. */
  title?: string;
};

export function MarkdownPreviewModal({
  markdown,
  open,
  onOpenChange,
  title,
}: MarkdownPreviewModalProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className={title ? "text-xl font-semibold" : "sr-only"}>
            {title ?? "Document Preview"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Fullscreen markdown document preview.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 flex-1 overflow-hidden">
          <div className="relative max-h-[calc(100dvh-12rem)] overflow-y-auto px-6 pt-4 pb-6">
            <MarkdownRenderer
              markdown={markdown}
              variant="document"
              premiumCodeBlocks={hasLabeledCodeFence(markdown)}
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
