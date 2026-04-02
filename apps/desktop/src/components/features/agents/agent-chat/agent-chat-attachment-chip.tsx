import type { AgentAttachmentReference } from "@openducktor/core";
import { FileAudio2, FileText, Film, Image as ImageIcon, LoaderCircle, X } from "lucide-react";
import type { ReactElement, SyntheticEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  type AgentChatAttachmentPreviewTarget,
  useAgentChatAttachmentPreview,
} from "./use-agent-chat-attachment-preview";

const ATTACHMENT_ICON = {
  image: ImageIcon,
  audio: FileAudio2,
  video: Film,
  pdf: FileText,
} as const;

function AttachmentName({ name }: { name: string }): ReactElement {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="min-w-0 truncate text-xs text-foreground" title={name}>
            {name}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{name}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type DraftAttachmentChipProps = {
  variant: "draft";
  attachment: AgentChatAttachmentPreviewTarget;
  error?: string | null;
  onRemove: () => void;
  className?: string;
};

type TranscriptAttachmentChipProps = {
  variant: "transcript";
  attachment: AgentAttachmentReference;
  className?: string;
};

export function AgentChatAttachmentChip(
  props: DraftAttachmentChipProps | TranscriptAttachmentChipProps,
): ReactElement {
  const { variant, attachment, className } = props;
  const Icon = ATTACHMENT_ICON[attachment.kind];
  const draftProps = variant === "draft" ? props : null;
  const {
    dialogOpen,
    setDialogOpen,
    resolvedPreviewSrc,
    previewError,
    effectiveError,
    isResolvingPreview,
    previewable,
    showResolvedPreview,
    requestPreviewOpen,
    markPreviewUnavailable,
  } = useAgentChatAttachmentPreview({
    attachment,
    externalError: draftProps?.error ?? null,
  });
  const removable = variant === "draft";
  const onRemove = draftProps?.onRemove ?? null;

  const handlePreviewMediaError = (
    event: SyntheticEvent<HTMLImageElement | HTMLVideoElement>,
  ): void => {
    const failingSrc =
      event.currentTarget.currentSrc || event.currentTarget.getAttribute("src") || undefined;
    markPreviewUnavailable(failingSrc);
  };

  const handleOpenPreview = (): void => {
    const previewError = requestPreviewOpen();
    if (!previewError) {
      return;
    }
    toast.error("Unable to open attachment preview", {
      description: previewError,
    });
  };

  return (
    <>
      <div
        className={cn(
          "relative flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card",
          effectiveError ? "border-destructive bg-destructive/5" : "border-border",
          previewable ? "w-40" : "max-w-full min-w-0",
          className,
        )}
      >
        {removable && onRemove ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute right-1 top-1 z-10 size-6 rounded-full bg-card/90 text-muted-foreground hover:bg-card hover:text-foreground"
            aria-label={`Remove ${attachment.name}`}
            onClick={onRemove}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}

        {previewable ? (
          <button
            type="button"
            className="flex w-full flex-col text-left"
            onClick={handleOpenPreview}
          >
            <div className="flex h-24 max-h-24 items-center justify-center overflow-hidden bg-muted">
              {showResolvedPreview ? (
                attachment.kind === "image" ? (
                  <img
                    src={resolvedPreviewSrc ?? undefined}
                    alt={attachment.name}
                    className="h-full w-full object-cover"
                    onError={handlePreviewMediaError}
                  />
                ) : (
                  <video
                    src={resolvedPreviewSrc ?? undefined}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                    onError={handlePreviewMediaError}
                  >
                    <track kind="captions" />
                  </video>
                )
              ) : isResolvingPreview ? (
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <Icon className="size-5 text-muted-foreground" />
              )}
            </div>
            <div className="flex items-center gap-2 px-3 py-2">
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <AttachmentName name={attachment.name} />
            </div>
          </button>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <AttachmentName name={attachment.name} />
          </div>
        )}

        {effectiveError ? (
          <p className="border-t border-destructive/20 px-3 py-2 text-[11px] text-destructive">
            {effectiveError}
          </p>
        ) : null}
      </div>

      {previewable && resolvedPreviewSrc && !previewError ? (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-[min(96vw,72rem)] border-border bg-background">
            <DialogHeader>
              <DialogTitle>{attachment.name}</DialogTitle>
              <DialogDescription>
                {attachment.kind === "image" ? "Image preview" : "Video preview"}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[80vh] overflow-hidden rounded-md border border-border bg-muted">
              {attachment.kind === "image" ? (
                <img
                  src={resolvedPreviewSrc}
                  alt={attachment.name}
                  className="max-h-[75vh] w-full object-contain"
                  onError={handlePreviewMediaError}
                />
              ) : (
                <video
                  src={resolvedPreviewSrc}
                  className="max-h-[75vh] w-full object-contain"
                  controls
                  autoPlay
                  onError={handlePreviewMediaError}
                >
                  <track kind="captions" />
                </video>
              )}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
