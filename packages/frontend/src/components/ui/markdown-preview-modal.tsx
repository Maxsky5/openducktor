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
      <DialogContent>
        <DialogHeader>
          <DialogTitle className={title ? undefined : "sr-only"}>
            {title ?? "Document Preview"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Fullscreen markdown document preview.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="relative">
            <MarkdownRenderer
              markdown={markdown}
              variant="document"
              premiumCodeBlocks={hasLabeledCodeFence(markdown)}
            />
            <DocumentCopyButton
              markdown={markdown}
              dataTestId="markdown-preview-modal-copy"
              errorLogContext="MarkdownPreviewModal"
              className="absolute top-2 right-2 z-10"
            />
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
