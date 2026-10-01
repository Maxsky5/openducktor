import { Check, Copy, Download } from "lucide-react";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";

type AgentChatGeneratedImageActionsProps = {
  src: string;
  blob: Blob;
};

export function AgentChatGeneratedImageActions({
  src,
  blob,
}: AgentChatGeneratedImageActionsProps): ReactElement {
  const [isCopying, setIsCopying] = useState(false);
  const { copied, copyToClipboard } = useCopyToClipboard({
    successMessage: "Image copied",
    copyFailedMessage: "Could not copy image",
    copyFailedDescription: "Try again or use Download to save this image.",
  });
  const copyImage = async (): Promise<void> => {
    if (isCopying) return;
    if (!navigator.clipboard?.write || !globalThis.ClipboardItem) {
      toast.error("Image copying is unavailable", {
        description: "Use Download to save this image.",
      });
      return;
    }
    setIsCopying(true);
    try {
      await copyToClipboard(blob);
    } finally {
      setIsCopying(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="ghost" size="icon" className="size-8 text-muted-foreground">
              <a href={src} download="generated-image.png" aria-label="Download generated image">
                <Download aria-hidden="true" />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download image</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              aria-label="Copy generated image"
              aria-disabled={isCopying}
              aria-busy={isCopying}
              onClick={() => void copyImage()}
            >
              {copied ? (
                <Check aria-hidden="true" className="text-emerald-500 dark:text-emerald-400" />
              ) : (
                <Copy aria-hidden="true" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Copied" : "Copy image"}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
