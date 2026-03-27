import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getClipboardErrorMessage } from "@/lib/clipboard";

type UseCopyToClipboardOptions = {
  successMessage?: string;
  getSuccessDescription?: ((value: string) => string | undefined) | undefined;
  copyFailedMessage?: string;
  resetDelayMs?: number;
  errorLogContext?: string;
};

type UseCopyToClipboardResult = {
  copied: boolean;
  copyToClipboard: (value: string) => Promise<boolean>;
};

const DEFAULT_SUCCESS_MESSAGE = "Copied!";
const DEFAULT_COPY_FAILED_MESSAGE = "Copy failed";
const DEFAULT_RESET_DELAY_MS = 2000;

export function useCopyToClipboard({
  successMessage = DEFAULT_SUCCESS_MESSAGE,
  getSuccessDescription,
  copyFailedMessage = DEFAULT_COPY_FAILED_MESSAGE,
  resetDelayMs = DEFAULT_RESET_DELAY_MS,
  errorLogContext,
}: UseCopyToClipboardOptions = {}): UseCopyToClipboardResult {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timeoutId = setTimeout(() => {
      setCopied(false);
    }, resetDelayMs);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [copied, resetDelayMs]);

  const copyToClipboard = useCallback(
    async (value: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        const description = getSuccessDescription?.(value);
        if (description) {
          toast.success(successMessage, { description });
        } else {
          toast.success(successMessage);
        }
        return true;
      } catch (error) {
        if (errorLogContext) {
          console.error(`[${errorLogContext}] Clipboard write failed:`, error);
        }
        const message =
          error instanceof DOMException ? getClipboardErrorMessage(error) : copyFailedMessage;
        toast.error(message);
        return false;
      }
    },
    [copyFailedMessage, errorLogContext, getSuccessDescription, successMessage],
  );

  return {
    copied,
    copyToClipboard,
  };
}
