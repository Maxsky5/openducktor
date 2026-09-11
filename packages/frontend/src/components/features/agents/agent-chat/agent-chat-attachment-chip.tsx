import type { AgentAttachmentReference } from "@openducktor/core";
import {
  FileAudio2,
  FileText,
  Film,
  Image as ImageIcon,
  LoaderCircle,
  type LucideIcon,
  X,
} from "lucide-react";
import type { ReactElement, SyntheticEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { MediaPreviewDialog, type MediaPreviewItem } from "@/components/ui/media-preview-dialog";
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

const buildAttachmentPreviewMedia = (
  attachment: { kind: AgentAttachmentReference["kind"]; name: string },
  previewSrc: string | null,
): MediaPreviewItem[] => {
  if (previewSrc === null) {
    return [];
  }
  if (attachment.kind === "video") {
    return [{ kind: "video", src: previewSrc, ariaLabel: `Preview video ${attachment.name}` }];
  }
  return [{ kind: "image", src: previewSrc, alt: attachment.name }];
};

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

  const handleDialogPreviewMediaError = (media: MediaPreviewItem): void => {
    markPreviewUnavailable(media.src);
  };

  const previewMedia = buildAttachmentPreviewMedia(attachment, resolvedPreviewSrc);

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
          previewable ? "cursor-pointer" : undefined,
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
            className="flex w-full cursor-pointer flex-col text-left"
            onClick={handleOpenPreview}
          >
            <div className="flex h-24 max-h-24 items-center justify-center overflow-hidden bg-muted">
              <AttachmentThumbnail
                icon={Icon}
                kind={attachment.kind}
                name={attachment.name}
                resolvedPreviewSrc={resolvedPreviewSrc}
                showResolvedPreview={showResolvedPreview}
                isResolvingPreview={isResolvingPreview}
                onUnavailable={markPreviewUnavailable}
              />
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
        <MediaPreviewDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title={attachment.name}
          description={attachment.kind === "image" ? "Image preview" : "Video preview"}
          media={previewMedia}
          onMediaError={handleDialogPreviewMediaError}
        />
      ) : null}
    </>
  );
}

const AttachmentThumbnail = ({
  icon: Icon,
  kind,
  name,
  resolvedPreviewSrc,
  showResolvedPreview,
  isResolvingPreview,
  onUnavailable,
}: {
  icon: LucideIcon;
  kind: AgentAttachmentReference["kind"];
  name: string;
  resolvedPreviewSrc: string | null;
  showResolvedPreview: boolean;
  isResolvingPreview: boolean;
  onUnavailable: (failingSrc?: string) => void;
}): ReactElement => {
  const handleMediaError = (event: SyntheticEvent<HTMLImageElement | HTMLVideoElement>): void => {
    const failingSrc =
      event.currentTarget.currentSrc ||
      event.currentTarget.getAttribute("src") ||
      resolvedPreviewSrc ||
      undefined;
    onUnavailable(failingSrc);
  };
  if (showResolvedPreview && kind === "image") {
    return (
      <img
        src={resolvedPreviewSrc ?? undefined}
        alt={name}
        className="h-full w-full object-cover"
        onError={handleMediaError}
      />
    );
  }
  if (showResolvedPreview && kind === "video") {
    return (
      <video
        src={resolvedPreviewSrc ?? undefined}
        aria-label={`Preview video ${name}`}
        className="h-full w-full object-cover"
        muted
        playsInline
        preload="metadata"
        onError={handleMediaError}
      >
        <track kind="captions" />
      </video>
    );
  }
  if (isResolvingPreview) {
    return <LoaderCircle className="size-4 animate-spin text-muted-foreground" />;
  }
  return <Icon className="size-5 text-muted-foreground" />;
};
