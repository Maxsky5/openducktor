import type { AgentImageGenerationPart, AgentSessionLiveRef } from "@openducktor/contracts";
import { LoaderCircle } from "lucide-react";
import { type ReactElement, useContext, useState } from "react";
import { Button } from "@/components/ui/button";
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

const generationStatus = (part: AgentImageGenerationPart): string => {
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
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
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
          className="h-auto w-40 max-w-full flex-col gap-0 overflow-hidden p-0"
        >
          <img src={src} alt={alt} className="h-28 w-full object-contain" onError={onImageError} />
          <span className="p-2">View image</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[min(96vw,72rem)] gap-4">
        <DialogHeader>
          <DialogTitle>Generated image</DialogTitle>
          <DialogDescription>{alt}</DialogDescription>
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
  if (part.savedPath !== undefined) input.savedPath = part.savedPath;
  return (
    <GeneratedImagePreview
      key={JSON.stringify(agentGeneratedImageQueryKeys.image(input))}
      input={input}
      alt={part.revisedPrompt || "Generated image"}
    />
  );
}

export function AgentChatImageGeneration({
  part,
}: {
  part: AgentImageGenerationPart;
}): ReactElement {
  const sessionRef = useContext(AgentChatImageSessionContext);
  const resetSeconds = part.failure?.resetsAtEpochSeconds;
  return (
    <div className="my-2 flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 text-foreground">
      <p role="status" className="inline-flex items-center gap-2 text-sm font-medium">
        {part.status === "running" ? (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        ) : null}
        {generationStatus(part)}
      </p>
      {part.revisedPrompt ? (
        <p className="whitespace-pre-wrap break-words text-sm">{part.revisedPrompt}</p>
      ) : null}
      {part.savedPath !== undefined ? (
        <p className="break-all font-mono text-xs text-muted-foreground">{part.savedPath}</p>
      ) : null}
      {part.transparentBackground !== undefined ? (
        <p className="text-xs text-muted-foreground">
          Transparent background: {part.transparentBackground ? "yes" : "no"}
        </p>
      ) : null}
      {part.status === "completed" ? (
        sessionRef ? (
          <CompletedImage part={part} sessionRef={sessionRef} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Preview unavailable: the session reference is missing. Reopen the session.
          </p>
        )
      ) : null}
      {part.status === "failed" ? (
        <p role="alert" className="text-sm text-destructive">
          {part.failure?.message ||
            "The runtime could not generate this image. Check the session in the runtime."}
        </p>
      ) : null}
      {part.status === "failed" && resetSeconds !== undefined ? (
        <p className="text-sm text-muted-foreground">
          Wait until {new Date(resetSeconds * 1000).toLocaleString()} before requesting another
          image.
        </p>
      ) : null}
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
    </div>
  );
}
