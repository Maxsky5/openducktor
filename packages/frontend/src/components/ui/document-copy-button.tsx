import { ShortcutScope } from "@/features/shortcuts/shortcut-controls";
import { useLocalShortcuts } from "@/features/shortcuts/use-local-shortcuts";
import {
  type ComponentProps,
  type MouseEvent,
  type ReactElement,
  useCallback,
  useRef,
} from "react";
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

  const root = useRef<HTMLButtonElement>(null);
  const shortcutOwner = useLocalShortcuts(
    root,
    [
      {
        id: "content-copy" as const,
        run: () => {
          void copyToClipboard(markdown);
        },
      },
    ],
    "[data-artifact-view], [data-markdown-preview]",
  );
  const handleCopy = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      event.preventDefault();
      void copyToClipboard(markdown);
    },
    [copyToClipboard, markdown],
  );

  return (
    <ShortcutScope owners={[shortcutOwner]}>
      <CopyIconButton
        shortcutId="content-copy"
        ref={root}
        copied={copied}
        ariaLabel="Copy artifact content"
        dataTestId={dataTestId}
        onClick={handleCopy}
        tooltipSide={tooltipSide}
        {...(className && { className })}
      />
    </ShortcutScope>
  );
}
