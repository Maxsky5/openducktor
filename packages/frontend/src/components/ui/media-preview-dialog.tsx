import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";

export type MediaPreviewItem =
  | { id: string; kind: "image"; src: string; alt: string; unavailableLabel?: string }
  | { id: string; kind: "video"; src: string; ariaLabel: string };

export const MediaPreviewDialog = ({
  open,
  onOpenChange,
  title,
  description,
  media,
  onMediaError,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  media: readonly MediaPreviewItem[];
  onMediaError?: (media: MediaPreviewItem) => void;
  trigger?: ReactNode;
}): ReactElement => {
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setFailedSources((previous) => (previous.size === 0 ? previous : new Set()));
  }, [open]);

  const handleMediaError = (item: MediaPreviewItem): void => {
    if (onMediaError) {
      onMediaError(item);
      return;
    }
    setFailedSources((previous) => new Set(previous).add(item.src));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent className="my-0 max-w-[min(96vw,72rem)] gap-4 border-border bg-background">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[80vh] space-y-2 overflow-y-auto rounded-md border border-border bg-muted/40 p-2">
          {media.map((item) => (
            <MediaPreviewItemView
              key={item.id}
              item={item}
              failed={failedSources.has(item.src)}
              onMediaError={handleMediaError}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const MediaPreviewItemView = ({
  item,
  failed,
  onMediaError,
}: {
  item: MediaPreviewItem;
  failed: boolean;
  onMediaError: (item: MediaPreviewItem) => void;
}): ReactElement => {
  if (failed) {
    return (
      <p role="alert" className="rounded border border-border bg-muted/50 px-2 py-2 text-[11px]">
        {item.kind === "image"
          ? (item.unavailableLabel ?? "Preview unavailable.")
          : "Preview unavailable."}
      </p>
    );
  }
  if (item.kind === "video") {
    return (
      <video
        src={item.src}
        aria-label={item.ariaLabel}
        className="max-h-[75vh] w-full object-contain"
        controls
        autoPlay
        muted
        playsInline
        onError={() => onMediaError(item)}
      >
        <track kind="captions" />
      </video>
    );
  }
  return (
    <img
      src={item.src}
      alt={item.alt}
      className="max-h-[75vh] w-full rounded border border-border bg-muted/40 object-contain"
      onError={() => onMediaError(item)}
    />
  );
};
