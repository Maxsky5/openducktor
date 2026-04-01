import type { AgentAttachmentReference } from "@openducktor/core";
import { FileAudio2, FileText, Film, Image as ImageIcon, LoaderCircle, X } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resolveLocalAttachmentPreviewSrc } from "@/lib/local-attachment-files";
import { cn } from "@/lib/utils";
import { isPreviewableAttachmentKind } from "./agent-chat-attachments";

type DraftAttachmentLike = {
  id: string;
  name: string;
  kind: AgentAttachmentReference["kind"];
  mime?: string;
  path?: string;
  file?: File;
};

const ATTACHMENT_ICON = {
  image: ImageIcon,
  audio: FileAudio2,
  video: Film,
  pdf: FileText,
} as const;

const readPreviewLoadFailureMessage = (attachmentName: string): string => {
  return `Attachment preview is unavailable because "${attachmentName}" could not be read from its original local path.`;
};

const readPreviewUrlForAttachment = (attachment: DraftAttachmentLike): string | null => {
  if (attachment.file && isPreviewableAttachmentKind(attachment.kind)) {
    return URL.createObjectURL(attachment.file);
  }
  return null;
};

export function AgentChatAttachmentChip({
  attachment,
  error,
  removable = false,
  onRemove,
  className,
}: {
  attachment: AgentAttachmentReference | DraftAttachmentLike;
  error?: string | null;
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
}): ReactElement {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resolvedPreviewSrc, setResolvedPreviewSrc] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isResolvingPreview, setIsResolvingPreview] = useState(false);
  const previewable = isPreviewableAttachmentKind(attachment.kind);
  const Icon = ATTACHMENT_ICON[attachment.kind];

  const objectPreviewUrl = useMemo(() => readPreviewUrlForAttachment(attachment), [attachment]);

  const markPreviewUnavailable = useCallback(() => {
    setDialogOpen(false);
    setResolvedPreviewSrc(null);
    setPreviewError(readPreviewLoadFailureMessage(attachment.name));
  }, [attachment.name]);

  useEffect(() => {
    return () => {
      if (objectPreviewUrl) {
        URL.revokeObjectURL(objectPreviewUrl);
      }
    };
  }, [objectPreviewUrl]);

  useEffect(() => {
    let cancelled = false;
    if (!previewable || objectPreviewUrl) {
      setResolvedPreviewSrc(objectPreviewUrl ?? null);
      setPreviewError(null);
      setIsResolvingPreview(false);
      return;
    }
    if (!attachment.path) {
      setResolvedPreviewSrc(null);
      setPreviewError("Attachment preview is unavailable because the local file path is missing.");
      setIsResolvingPreview(false);
      return;
    }

    setIsResolvingPreview(true);
    setPreviewError(null);
    void resolveLocalAttachmentPreviewSrc(attachment.path, attachment.mime)
      .then((src) => {
        if (cancelled) {
          return;
        }
        setResolvedPreviewSrc(src);
      })
      .catch((resolveError) => {
        if (cancelled) {
          return;
        }
        setResolvedPreviewSrc(null);
        setPreviewError(
          resolveError instanceof Error ? resolveError.message : String(resolveError),
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsResolvingPreview(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attachment.mime, attachment.path, objectPreviewUrl, previewable]);

  const effectiveError = error ?? previewError;
  const canOpenPreview = previewable && Boolean(resolvedPreviewSrc) && !effectiveError;
  const showResolvedPreview = Boolean(resolvedPreviewSrc) && !previewError;

  const handleOpenPreview = (): void => {
    if (canOpenPreview) {
      setDialogOpen(true);
      return;
    }
    toast.error("Unable to open attachment preview", {
      description:
        effectiveError ??
        "The attachment preview is not available because the local file could not be resolved.",
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
            <div className="flex aspect-video items-center justify-center bg-muted">
              {showResolvedPreview ? (
                attachment.kind === "image" ? (
                  <img
                    src={resolvedPreviewSrc ?? undefined}
                    alt={attachment.name}
                    className="h-full w-full object-cover"
                    onError={markPreviewUnavailable}
                  />
                ) : (
                  <video
                    src={resolvedPreviewSrc ?? undefined}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                    onError={markPreviewUnavailable}
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
              <span className="min-w-0 truncate text-xs text-foreground">{attachment.name}</span>
            </div>
          </button>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-xs text-foreground">{attachment.name}</span>
          </div>
        )}

        {effectiveError ? (
          <p className="border-t border-destructive/20 px-3 py-2 text-[11px] text-destructive">
            {effectiveError}
          </p>
        ) : null}
      </div>

      {previewable && resolvedPreviewSrc && !effectiveError ? (
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
                  onError={markPreviewUnavailable}
                />
              ) : (
                <video
                  src={resolvedPreviewSrc}
                  className="max-h-[75vh] w-full object-contain"
                  controls
                  autoPlay
                  onError={markPreviewUnavailable}
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
