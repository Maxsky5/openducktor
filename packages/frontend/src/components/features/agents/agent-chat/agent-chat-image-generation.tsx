import { useQuery } from "@tanstack/react-query";
import type { AgentImageGenerationPart, AgentSessionLiveRef } from "@openducktor/contracts";
import { ChevronDown, ImageIcon, LoaderCircle, TextAlignStart, TriangleAlert } from "lucide-react";
import { type ReactElement, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { DialogTrigger } from "@/components/ui/dialog";
import { MediaPreviewDialog } from "@/components/ui/media-preview-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import {
  useAgentOperationsContext,
  useRuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import {
  generatedImageMetadataQueryOptions,
  type GeneratedImageMetadataInput,
} from "@/state/queries/agent-generated-image-metadata";
import {
  agentGeneratedImageQueryKeys,
  type AgentGeneratedImageQueryInput,
} from "@/state/queries/agent-generated-images";
import { AgentChatImageSessionContext } from "./agent-chat-image-session-context";
import { AgentChatGeneratedImageActions } from "./agent-chat-generated-image-actions";
import { useAgentGeneratedImagePreview } from "./use-agent-generated-image-preview";

type AgentChatImageGenerationProps = { part: AgentImageGenerationPart };

type ImagePreviewProps = {
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AgentChatImageGeneration({ part }: AgentChatImageGenerationProps): ReactElement {
  const sessionRef = useContext(AgentChatImageSessionContext);
  return (
    <div
      className={cn(
        "my-2 flex w-full min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-3 text-foreground shadow-sm",
        part.status !== "completed" && "max-w-lg",
      )}
    >
      {part.status !== "completed" || !sessionRef ? (
        <ImageGenerationHeader label={statusLabel(part)} running={part.status === "running"} />
      ) : null}
      {part.status === "running" ? <GeneratingImage /> : null}
      {part.status === "completed" && sessionRef ? (
        <CompletedImage part={part} sessionRef={sessionRef} />
      ) : null}
      {part.status === "completed" && !sessionRef ? (
        <p className="text-sm text-muted-foreground">
          Preview unavailable: the session reference is missing. Reopen the session.
        </p>
      ) : null}
      {part.status === "failed" ? <ImageFailure failure={part.failure} /> : null}
      {part.status === "interrupted" ? (
        <p className="text-sm text-muted-foreground">
          The turn stopped before the runtime confirmed an image result.
        </p>
      ) : null}
      {part.status === "incomplete" ? (
        <p className="text-sm text-muted-foreground">
          {part.incompleteReason === "runtime_failure"
            ? "The turn failed before the runtime confirmed an image result."
            : "The runtime did not confirm an image result. Check the session in the runtime."}
        </p>
      ) : null}
      <ImageDetails key={JSON.stringify([sessionRef, part.turnId, part.itemId])} part={part} />
    </div>
  );
}

function ImageGenerationHeader({
  label,
  running = false,
  children,
}: {
  label: string;
  running?: boolean;
  children?: ReactNode;
}): ReactElement {
  return (
    <div className="flex h-8 min-w-0 shrink-0 items-center justify-between gap-3">
      <p role="status" className="inline-flex min-w-0 items-center gap-2 text-sm font-medium">
        {running ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-4 shrink-0 motion-safe:animate-spin text-muted-foreground"
          />
        ) : (
          <ImageIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        )}
        {label}
      </p>
      {children}
    </div>
  );
}

function GeneratedImageFrame({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ImageGenerationHeader label="Image generated">{actions}</ImageGenerationHeader>
      {children}
    </div>
  );
}

function GeneratingImage(): ReactElement {
  return (
    <Skeleton
      aria-hidden="true"
      className="aspect-[4/3] max-h-64 w-full rounded-lg motion-reduce:animate-none"
    />
  );
}

function ImagePreviewSkeleton(): ReactElement {
  return (
    <div role="status" aria-label="Loading generated image preview" className="h-64 w-full">
      <Skeleton
        aria-hidden="true"
        className="h-full w-full rounded-lg motion-reduce:animate-none"
      />
    </div>
  );
}

function ImageDetails({ part }: { part: AgentImageGenerationPart }): ReactElement | null {
  if (
    !part.revisedPrompt &&
    part.savedPath === undefined &&
    part.transparentBackground === undefined
  )
    return null;
  return (
    <Collapsible className="min-w-0">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="group w-full justify-start text-muted-foreground"
        >
          Image details
          <ChevronDown
            aria-hidden="true"
            data-icon="inline-end"
            className="ml-auto transition-transform motion-reduce:transition-none group-data-[state=open]:rotate-180"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 flex min-w-0 flex-col gap-3">
          {part.savedPath !== undefined ? (
            <SavedImagePath key={part.savedPath} path={part.savedPath} />
          ) : null}
          {part.transparentBackground !== undefined ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              Background
              <Badge variant="secondary">
                {part.transparentBackground ? "Transparent" : "Opaque"}
              </Badge>
            </div>
          ) : null}
          {part.revisedPrompt ? (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="group w-full justify-start gap-2 text-muted-foreground"
                >
                  <TextAlignStart aria-hidden="true" className="size-4" />
                  View prompt
                  <ChevronDown
                    aria-hidden="true"
                    className="ml-auto size-4 transition-transform motion-reduce:transition-none group-data-[state=open]:rotate-180"
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Generation prompt</p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {part.revisedPrompt}
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SavedImagePath({ path }: { path: string }): ReactElement {
  const { copied, copyToClipboard } = useCopyToClipboard({
    getSuccessDescription: (value) => value,
    errorLogContext: "AgentChatImageGeneration",
  });
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted-foreground">Saved file</p>
      <p className="mt-1 text-xs text-muted-foreground">
        <span className="break-all font-mono">{path}</span>
        <CopyIconButton
          copied={copied}
          ariaLabel="Copy generated image path"
          tooltipLabel={copied ? "Copied" : "Copy generated image path"}
          className="ml-1 size-6 align-middle border-transparent bg-transparent hover:bg-muted"
          onClick={() => {
            void copyToClipboard(path);
          }}
        />
      </p>
    </div>
  );
}

function CompletedImage({
  part,
  sessionRef,
}: {
  part: AgentImageGenerationPart;
  sessionRef: AgentSessionLiveRef;
}): ReactElement {
  const { runtimeDefinitions } = useRuntimeDefinitionsContext();
  const supported =
    runtimeDefinitions.find((runtime) => runtime.kind === sessionRef.runtimeKind)?.capabilities
      .optionalSurfaces.supportsImageGeneration === true;
  if (!supported)
    return (
      <>
        <ImageGenerationHeader label="Image generated" />
        <p className="text-sm text-muted-foreground">
          This runtime does not support image previews.
        </p>
      </>
    );
  if (!part.output && part.savedPath !== undefined && !part.previewUnavailableReason) {
    const input: GeneratedImageMetadataInput = { ref: sessionRef, itemId: part.itemId };
    if (part.turnId !== undefined) input.turnId = part.turnId;
    return (
      <GeneratedImagePreview
        key={JSON.stringify(input)}
        input={input}
        alt={part.revisedPrompt || "Generated image"}
      />
    );
  }
  if (!part.output)
    return (
      <>
        <ImageGenerationHeader label="Image generated" />
        <p className="text-sm text-muted-foreground">
          {part.previewUnavailableReason ??
            "Preview unavailable: the runtime did not report image output. Check the session in the runtime."}
        </p>
      </>
    );
  const input: AgentGeneratedImageQueryInput = {
    ref: sessionRef,
    itemId: part.itemId,
    revision: part.output.revision,
  };
  if (part.turnId !== undefined) input.turnId = part.turnId;
  return (
    <GeneratedImagePreview
      key={JSON.stringify(agentGeneratedImageQueryKeys.image(input))}
      input={input}
      alt={part.revisedPrompt || "Generated image"}
    />
  );
}

function ImageFailure({ failure }: { failure: AgentImageGenerationPart["failure"] }): ReactElement {
  const resetSeconds = failure?.resetsAtEpochSeconds;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="whitespace-pre-wrap break-words text-sm">
          {failure?.message ||
            "The runtime could not generate this image. It did not provide a failure reason."}
        </p>
        {failure?.kind !== "usage_limit" ? (
          <p className="text-sm text-muted-foreground">
            Ask the agent to explain this failure before trying again.
          </p>
        ) : null}
        {resetSeconds !== undefined ? (
          <p className="text-sm text-muted-foreground">
            Wait until {new Date(resetSeconds * 1000).toLocaleString()} before requesting another
            image.
          </p>
        ) : null}
        {failure?.kind === "usage_limit" && resetSeconds === undefined ? (
          <p className="text-sm text-muted-foreground">
            Check image-generation usage limits in the runtime before requesting another image.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function GeneratedImagePreview({
  input,
  alt,
}: {
  input: GeneratedImageMetadataInput & { revision?: string };
  alt: string;
}): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setVisible(entry.isIntersecting);
      },
      { root: element.closest(".agent-chat-scroll-region"), rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  let content: ReactElement;
  if (!visible && !open) {
    content = (
      <GeneratedImageFrame>
        <ImagePreviewSkeleton />
      </GeneratedImageFrame>
    );
  } else if (input.revision === undefined) {
    content = <SavedImagePreview input={input} alt={alt} open={open} onOpenChange={setOpen} />;
  } else {
    content = (
      <LoadedImagePreview
        input={{ ...input, revision: input.revision }}
        alt={alt}
        open={open}
        onOpenChange={setOpen}
      />
    );
  }

  return (
    <div ref={container} className="min-w-0">
      {content}
    </div>
  );
}

function SavedImagePreview({
  input,
  alt,
  open,
  onOpenChange,
}: ImagePreviewProps & {
  input: GeneratedImageMetadataInput;
}): ReactElement {
  const operations = useAgentOperationsContext();
  const metadata = useQuery(generatedImageMetadataQueryOptions(input, operations));
  if (metadata.error)
    return (
      <GeneratedImageFrame>
        <p
          role="alert"
          className="whitespace-pre-wrap text-sm text-destructive [overflow-wrap:anywhere]"
        >
          {metadata.error.message}
        </p>
      </GeneratedImageFrame>
    );
  if (!metadata.data)
    return (
      <GeneratedImageFrame>
        <ImagePreviewSkeleton />
      </GeneratedImageFrame>
    );
  return (
    <LoadedImagePreview
      key={metadata.data.revision}
      input={{ ...input, revision: metadata.data.revision }}
      alt={alt}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

function LoadedImagePreview({
  input,
  alt,
  open,
  onOpenChange,
}: ImagePreviewProps & {
  input: AgentGeneratedImageQueryInput;
}): ReactElement {
  const operations = useAgentOperationsContext();
  const preview = useAgentGeneratedImagePreview(input, operations);
  const [displayFailed, setDisplayFailed] = useState(false);
  const error =
    preview.error ?? (displayFailed ? "Preview unavailable. Check the runtime output file." : null);
  if (error)
    return (
      <GeneratedImageFrame>
        <p
          role="alert"
          className="whitespace-pre-wrap text-sm text-destructive [overflow-wrap:anywhere]"
        >
          {error}
        </p>
      </GeneratedImageFrame>
    );
  if (!preview.src || !preview.blob)
    return (
      <GeneratedImageFrame>
        <ImagePreviewSkeleton />
      </GeneratedImageFrame>
    );
  const src = preview.src;
  const onImageError = () => {
    setDisplayFailed(true);
    onOpenChange(false);
  };
  return (
    <GeneratedImageFrame actions={<AgentChatGeneratedImageActions src={src} blob={preview.blob} />}>
      <MediaPreviewDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Generated image"
        description="Preview of the generated image."
        media={[{ id: "generated-image", kind: "image", src, alt }]}
        onMediaError={onImageError}
        actions={<AgentChatGeneratedImageActions src={src} blob={preview.blob} />}
        trigger={
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              aria-label="Open generated image preview"
              className="h-64 w-full min-w-0 overflow-hidden rounded-lg bg-muted/40 p-0"
            >
              <img
                src={src}
                alt={alt}
                className="h-full w-full object-contain"
                onError={onImageError}
              />
            </Button>
          </DialogTrigger>
        }
      />
    </GeneratedImageFrame>
  );
}

const statusLabel = (part: AgentImageGenerationPart): string => {
  switch (part.status) {
    case "running":
      return "Generating image…";
    case "completed":
      return "Image generated";
    case "failed":
      return part.failure?.kind === "usage_limit"
        ? "Image generation limit reached"
        : "Image generation failed";
    case "interrupted":
      return "Image generation interrupted";
    case "incomplete":
      return "Image generation outcome unknown";
  }
};
