import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getClipboardErrorMessage } from "@/lib/clipboard";

type UseCopyToClipboardOptions = {
  successMessage?: string;
  getSuccessDescription?: ((value: string) => string | undefined) | undefined;
  copyFailedMessage?: string;
  copyFailedDescription?: string;
  resetDelayMs?: number;
  errorLogContext?: string;
};

type UseCopyToClipboardResult = {
  copied: boolean;
  copyToClipboard: (value: string | Blob) => Promise<boolean>;
};

const DEFAULT_SUCCESS_MESSAGE = "Copied!";
const DEFAULT_COPY_FAILED_MESSAGE = "Copy failed";
const DEFAULT_RESET_DELAY_MS = 2000;

export function useCopyToClipboard({
  successMessage = DEFAULT_SUCCESS_MESSAGE,
  getSuccessDescription,
  copyFailedMessage = DEFAULT_COPY_FAILED_MESSAGE,
  copyFailedDescription,
  resetDelayMs = DEFAULT_RESET_DELAY_MS,
  errorLogContext,
}: UseCopyToClipboardOptions = {}): UseCopyToClipboardResult {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimeout = useCallback(() => {
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearResetTimeout, [clearResetTimeout]);

  const copyToClipboard = useCallback(
    async (value: string | Blob): Promise<boolean> => {
      try {
        if (value instanceof Blob) {
          await navigator.clipboard.write([new ClipboardItem({ [value.type]: value })]);
        } else {
          await navigator.clipboard.writeText(value);
        }
        clearResetTimeout();
        setCopied(true);
        resetTimeoutRef.current = setTimeout(() => {
          setCopied(false);
          resetTimeoutRef.current = null;
        }, resetDelayMs);
        const description = value instanceof Blob ? undefined : getSuccessDescription?.(value);
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
        if (copyFailedDescription) {
          toast.error(message, { description: copyFailedDescription });
        } else {
          toast.error(message);
        }
        return false;
      }
    },
    [
      clearResetTimeout,
      copyFailedMessage,
      copyFailedDescription,
      errorLogContext,
      getSuccessDescription,
      resetDelayMs,
      successMessage,
    ],
  );

  return {
    copied,
    copyToClipboard,
  };
}
