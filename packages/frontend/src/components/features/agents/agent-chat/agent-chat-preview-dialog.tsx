import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type AgentChatPreviewMedia =
  | { kind: "image"; src: string; alt: string; unavailableLabel?: string }
  | { kind: "video"; src: string; ariaLabel: string };

export const AgentChatPreviewDialog = ({
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
  media: readonly AgentChatPreviewMedia[];
  onMediaError?: (media: AgentChatPreviewMedia) => void;
  trigger?: ReactNode;
}): ReactElement => {
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    setFailedSources((previous) => (previous.size === 0 ? previous : new Set()));
  }, [open]);

  const handleMediaError = (item: AgentChatPreviewMedia): void => {
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
          {media.map((item, index) => {
            const key = `${item.kind}:${index}`;
            if (item.kind === "video") {
              return (
                <video
                  key={key}
                  src={item.src}
                  aria-label={item.ariaLabel}
                  className="max-h-[75vh] w-full object-contain"
                  controls
                  autoPlay
                  onError={() => handleMediaError(item)}
                >
                  <track kind="captions" />
                </video>
              );
            }
            if (failedSources.has(item.src)) {
              return (
                <p
                  key={key}
                  role="alert"
                  className="rounded border border-border bg-muted/50 px-2 py-2 text-[11px]"
                >
                  {item.unavailableLabel ?? "Preview unavailable."}
                </p>
              );
            }
            return (
              <img
                key={key}
                src={item.src}
                alt={item.alt}
                className="max-h-[75vh] w-full rounded border border-border bg-muted/40 object-contain"
                onError={() => handleMediaError(item)}
              />
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};
