import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

export type MediaPreviewItem =
  | { id: string; kind: "image"; src: string; alt: string; unavailableLabel?: string }
  | { id: string; kind: "video"; src: string; ariaLabel: string };

type MediaElement = HTMLImageElement | HTMLVideoElement;
type MediaHandlers = {
  onMediaMount: (id: string, src: string, element: MediaElement) => void;
  onMediaSettled: (item: MediaPreviewItem, element: MediaElement) => void;
  onMediaError: (item: MediaPreviewItem, element: MediaElement) => void;
};

type MediaPreviewDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  media: readonly MediaPreviewItem[];
  onMediaError?: (media: MediaPreviewItem) => void;
  trigger?: ReactNode;
  actions?: ReactNode;
};

export function MediaPreviewDialog({
  open,
  onOpenChange,
  title,
  description,
  media,
  onMediaError,
  trigger,
  actions,
}: MediaPreviewDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(() => new Set());
  const [settledItems, setSettledItems] = useState<ReadonlySet<string>>(() => new Set());
  const settledNodes = useRef(new WeakMap<MediaElement, string>());

  useEffect(() => {
    setFailedSources((previous) => (previous.size === 0 ? previous : new Set()));
  }, [open]);

  const handleMediaMount = useCallback((id: string, src: string, element: MediaElement) => {
    // Activity and exit animations can attach the same, already loaded DOM node again.
    const settled = settledNodes.current.get(element) === src;
    setSettledItems((previous) => {
      if (previous.has(id) === settled) return previous;
      const next = new Set(previous);
      if (settled) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const settleMedia = (item: MediaPreviewItem, element: MediaElement): void => {
    settledNodes.current.set(element, item.src);
    setSettledItems((previous) =>
      previous.has(item.id) ? previous : new Set(previous).add(item.id),
    );
  };

  const handleMediaError = (item: MediaPreviewItem, element: MediaElement): void => {
    settleMedia(item, element);
    if (onMediaError) {
      onMediaError(item);
      return;
    }
    setFailedSources((previous) => new Set(previous).add(item.src));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger}
      <DialogContent
        // Blob and data URLs already contain the bytes; a new element needs no read.
        loading={media.some(
          (item) =>
            !item.src.startsWith("blob:") &&
            !item.src.startsWith("data:") &&
            !settledItems.has(item.id),
        )}
        loadingLabel="Loading preview…"
        ref={dialogRef}
        className="my-0 max-w-[min(96vw,72rem)] gap-4 border-border bg-background"
        onOpenAutoFocus={(event) => {
          if (!actions) return;
          event.preventDefault();
          dialogRef.current?.focus();
        }}
      >
        <DialogHeader className="bg-background pr-8">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <DialogTitle className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">
              {title}
            </DialogTitle>
          </div>
          <DialogDescription className="text-foreground/75">{description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex max-h-[80vh] flex-col gap-2 overflow-y-auto rounded-md border border-border bg-muted/40 p-2">
          {media.map((item) => (
            <MediaPreviewItemView
              key={item.id}
              item={item}
              failed={failedSources.has(item.src)}
              onMediaError={handleMediaError}
              onMediaSettled={settleMedia}
              onMediaMount={handleMediaMount}
            />
          ))}
        </DialogBody>
        {actions ? (
          <DialogFooter className="mt-0">
            <div className="flex w-full justify-end">{actions}</div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

const MediaPreviewItemView = ({
  item,
  failed,
  onMediaError,
  onMediaSettled,
  onMediaMount,
}: {
  item: MediaPreviewItem;
  failed: boolean;
} & MediaHandlers): ReactElement => {
  const { id, src } = item;
  const setImageRef = useCallback(
    (image: HTMLImageElement | null) => {
      if (image) onMediaMount(id, src, image);
    },
    [id, src, onMediaMount],
  );
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
      <PreviewVideo
        item={item}
        onMediaError={onMediaError}
        onMediaSettled={onMediaSettled}
        onMediaMount={onMediaMount}
      />
    );
  }
  return (
    <img
      ref={setImageRef}
      src={item.src}
      alt={item.alt}
      className="max-h-[75vh] w-full rounded border border-border bg-muted/40 object-contain"
      onError={(event) => onMediaError(item, event.currentTarget)}
      onLoad={(event) => onMediaSettled(item, event.currentTarget)}
    />
  );
};

function PreviewVideo({
  item,
  onMediaError,
  onMediaSettled,
  onMediaMount,
}: {
  item: Extract<MediaPreviewItem, { kind: "video" }>;
} & MediaHandlers): ReactElement {
  const ref = useRef<HTMLVideoElement>(null);
  const { id, src } = item;
  const setVideoRef = useCallback(
    (video: HTMLVideoElement | null) => {
      ref.current = video;
      if (video) onMediaMount(id, src, video);
    },
    [id, src, onMediaMount],
  );
  useLayoutEffect(() => {
    const video = ref.current;
    // Activity keeps the video DOM when it hides the chat.
    return () => video?.pause();
  }, [item.src]);
  return (
    <video
      ref={setVideoRef}
      src={item.src}
      aria-label={item.ariaLabel}
      className="max-h-[75vh] w-full object-contain"
      controls
      autoPlay
      muted
      playsInline
      onError={(event) => onMediaError(item, event.currentTarget)}
      onLoadedData={(event) => onMediaSettled(item, event.currentTarget)}
    >
      <track kind="captions" />
    </video>
  );
}
