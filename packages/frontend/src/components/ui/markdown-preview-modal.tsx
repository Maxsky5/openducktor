import { type MouseEvent, type ReactElement, useCallback } from "react";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { buildCopyPreview } from "@/lib/copy-preview";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

export type MarkdownPreviewModalProps = {
  markdown: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
};

const hasLabeledCodeFence = (markdown: string): boolean => {
  return markdown.includes("```") && /```[a-z0-9_-]+/i.test(markdown);
};

function MarkdownPreviewModalCopyButton({ markdown }: { markdown: string }): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    getSuccessDescription: buildCopyPreview,
    errorLogContext: "MarkdownPreviewModal",
  });

  const handleCopy = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      void copyToClipboard(markdown);
    },
    [copyToClipboard, markdown],
  );

  return (
    <CopyIconButton
      copied={copied}
      ariaLabel="Copy document content"
      dataTestId="markdown-preview-modal-copy"
      className="absolute top-2 right-2 z-10"
      onClick={handleCopy}
    />
  );
}

export function MarkdownPreviewModal({
  markdown,
  open,
  onOpenChange,
  title,
}: MarkdownPreviewModalProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>{title ? <DialogTitle>{title}</DialogTitle> : null}</DialogHeader>
        <DialogBody>
          <div className="relative">
            <MarkdownRenderer
              markdown={markdown}
              variant="document"
              premiumCodeBlocks={hasLabeledCodeFence(markdown)}
            />
            <MarkdownPreviewModalCopyButton markdown={markdown} />
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
