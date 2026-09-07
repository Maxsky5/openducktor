import type { AgentImageGenerationPart, AgentSessionLiveRef } from "@openducktor/contracts";
import {
  ChevronDown,
  ImageIcon,
  LoaderCircle,
  Maximize2,
  TextAlignStart,
  TriangleAlert,
} from "lucide-react";
import { type ReactElement, useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyIconButton } from "@/components/ui/copy-icon-button";
import { useCopyToClipboard } from "@/lib/use-copy-to-clipboard";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  useAgentOperationsContext,
  useRuntimeDefinitionsContext,
} from "@/state/app-state-contexts";
import {
  agentGeneratedImageQueryKeys,
  type AgentGeneratedImageQueryInput,
} from "@/state/queries/agent-generated-images";
import { AgentChatImageSessionContext } from "./agent-chat-image-session-context";
import { useAgentGeneratedImagePreview } from "./use-agent-generated-image-preview";

export function AgentChatImageGeneration({
  part,
}: {
  part: AgentImageGenerationPart;
}): ReactElement {
  const sessionRef = useContext(AgentChatImageSessionContext);
  return (
    <div
      className={cn(
        "my-2 flex w-full min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-3 text-foreground shadow-sm",
        part.status !== "completed" && "max-w-lg",
      )}
    >
      <p role="status" className="inline-flex items-center gap-2 text-sm font-medium">
        {part.status === "running" ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-4 motion-safe:animate-spin text-muted-foreground"
          />
        ) : (
          <ImageIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        )}
        {statusLabel(part)}
      </p>
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
          The runtime did not confirm an image result. Check the session in the runtime.
        </p>
      ) : null}
      <ImageDetails key={JSON.stringify([sessionRef, part.turnId, part.itemId])} part={part} />
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

function ImageDetails({ part }: { part: AgentImageGenerationPart }): ReactElement | null {
  if (
    !part.revisedPrompt &&
    part.savedPath === undefined &&
    part.transparentBackground === undefined
  )
    return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {part.savedPath !== undefined ? (
        <SavedImagePath key={part.savedPath} path={part.savedPath} />
      ) : null}
      {part.transparentBackground !== undefined ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Background
          <Badge variant="secondary">{part.transparentBackground ? "Transparent" : "Opaque"}</Badge>
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
      <p className="text-sm text-muted-foreground">This runtime does not support image previews.</p>
    );
  if (!part.output)
    return (
      <p className="text-sm text-muted-foreground">
        Preview unavailable: the runtime did not report image output. Check the session in the
        runtime.
      </p>
    );
  const input: AgentGeneratedImageQueryInput = {
    ref: sessionRef,
    itemId: part.itemId,
    output: part.output,
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
  input: AgentGeneratedImageQueryInput;
  alt: string;
}): ReactElement {
  const { readGeneratedImage } = useAgentOperationsContext();
  const preview = useAgentGeneratedImagePreview(input, readGeneratedImage);
  const [open, setOpen] = useState(false);
  const [displayFailed, setDisplayFailed] = useState(false);
  const error =
    preview.error ?? (displayFailed ? "Preview unavailable. Check the runtime output file." : null);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!preview.src)
    return (
      <p role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
        Loading image preview…
      </p>
    );
  const src = preview.src;
  const onImageError = () => {
    setDisplayFailed(true);
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label="Open generated image preview"
          className="h-auto w-full min-w-0 flex-col gap-0 overflow-hidden rounded-lg bg-muted/40 p-0"
        >
          <img
            src={src}
            alt={alt}
            className="max-h-80 w-full object-contain"
            onError={onImageError}
          />
          <span className="flex w-full items-center justify-center gap-2 border-t border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            <Maximize2 aria-hidden="true" className="size-3.5" />
            View image
          </span>
        </Button>
      </DialogTrigger>
      <DialogContent className="my-0 max-w-[min(96vw,72rem)] gap-4">
        <DialogHeader>
          <DialogTitle>Generated image</DialogTitle>
          <DialogDescription>Preview of the generated image.</DialogDescription>
        </DialogHeader>
        <img
          src={src}
          alt={alt}
          className="min-h-0 max-h-[70dvh] w-full object-contain"
          onError={onImageError}
        />
      </DialogContent>
    </Dialog>
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
