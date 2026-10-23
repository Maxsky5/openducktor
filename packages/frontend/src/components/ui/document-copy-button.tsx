import { type ComponentProps, type MouseEvent, type ReactElement, useCallback } from "react";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { buildCopyPreview } from "@/lib/copy-preview";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

type DocumentCopyButtonProps = {
  markdown: string;
  dataTestId: string;
  errorLogContext: string;
  className?: string;
  tooltipSide?: ComponentProps<typeof CopyIconButton>["tooltipSide"];
};

export function DocumentCopyButton({
  markdown,
  dataTestId,
  errorLogContext,
  className,
  tooltipSide,
}: DocumentCopyButtonProps): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    getSuccessDescription: buildCopyPreview,
    errorLogContext,
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
      ariaLabel="Copy artifact content"
      dataTestId={dataTestId}
      onClick={handleCopy}
      tooltipSide={tooltipSide}
      {...(className && { className })}
    />
  );
}
