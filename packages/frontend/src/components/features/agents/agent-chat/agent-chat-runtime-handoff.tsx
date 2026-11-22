import { RUNTIME_DESCRIPTORS_BY_KIND, type RuntimeKind } from "@openducktor/contracts";
import type { RuntimeHandoffNotice } from "@openducktor/frontend-core/sessions/send/runtime-handoff";
import type { RuntimeHandoffDirection } from "@openducktor/frontend-core/types/agent-orchestrator";
import { ArrowRight, ArrowRightLeft, X } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AgentRuntimeIcon } from "../agent-runtime-icon";
import { focusEditorEnd } from "./agent-chat-composer-selection";
import { AgentTranscriptSeparator } from "./agent-transcript-separator";

function RuntimeLabel({ kind, model }: { kind: RuntimeKind; model?: string | undefined }) {
  const runtime = RUNTIME_DESCRIPTORS_BY_KIND[kind].label;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <AgentRuntimeIcon runtimeKind={kind} className="size-3.5 shrink-0" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {model ? <span className="sr-only">{runtime}: </span> : null}
        {model ?? runtime}
      </span>
    </span>
  );
}

function RuntimeHandoffDivider({
  direction,
  title,
  sourceModel,
  destinationModel,
  className,
}: {
  direction: RuntimeHandoffDirection;
  title: string;
  sourceModel?: string | undefined;
  destinationModel?: string | undefined;
  className: string;
}) {
  return (
    <AgentTranscriptSeparator
      className={cn("text-secondary-foreground @max-[18rem]/handoff:gap-1", className)}
      label={
        <span className="flex items-center justify-center gap-x-3 gap-y-1.5 tracking-normal @max-[30rem]/handoff:flex-col">
          <span className="inline-flex max-w-full shrink-0 items-center gap-1.5 font-medium">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-emphasis/10 text-primary-emphasis">
              <ArrowRightLeft aria-hidden className="size-3.5" />
            </span>
            {title}
          </span>
          <span className="inline-flex min-w-0 max-w-full items-center justify-center gap-2 text-sm @max-[18rem]/handoff:gap-1 @max-[18rem]/handoff:text-xs @max-[14rem]/handoff:flex-col">
            <RuntimeLabel kind={direction.from} model={sourceModel} />
            <ArrowRight
              aria-hidden
              className="size-3.5 shrink-0 text-primary-emphasis @max-[14rem]/handoff:rotate-90"
            />
            <span className="sr-only">to </span>
            <span className="inline-flex min-w-0 max-w-full font-semibold text-foreground">
              <RuntimeLabel kind={direction.to} model={destinationModel} />
            </span>
          </span>
        </span>
      }
    />
  );
}

export function RuntimeHandoffMarker({
  direction,
  title,
  contextNote,
}: {
  direction: RuntimeHandoffDirection;
  title: string;
  contextNote: string | undefined;
}) {
  return (
    <article className="@container/handoff">
      <RuntimeHandoffDivider direction={direction} title={title} className="pt-6" />
      {contextNote ? (
        <p className="mx-auto max-w-prose px-3 text-center text-xs leading-relaxed text-secondary-foreground">
          {contextNote}
        </p>
      ) : null}
    </article>
  );
}

export function RuntimeHandoffCue({
  notice,
  sourceModel,
  currentRuntime,
  editorRef,
}: {
  notice: RuntimeHandoffNotice | null | undefined;
  sourceModel: string | undefined;
  currentRuntime: RuntimeKind | undefined;
  editorRef: RefObject<HTMLDivElement | null>;
}) {
  if (!notice) return null;
  const { cancel, check } = notice;
  const cancelHandoff = () => {
    if (!cancel?.()) return;
    const editor = editorRef.current;
    if (editor?.isConnected) focusEditorEnd(editor);
  };
  return (
    <div role="status" className="@container/handoff mb-2">
      <RuntimeHandoffDivider
        direction={notice.direction}
        title={notice.title}
        sourceModel={currentRuntime === notice.direction.from ? sourceModel : undefined}
        destinationModel={notice.destinationModel}
        className="pt-1 pb-1"
      />
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 px-2">
        <p className="max-w-prose text-center text-xs leading-relaxed text-pretty text-foreground/75">
          {notice.details}
        </p>
        {check || cancel ? (
          <Button
            type="button"
            size={check ? "sm" : "xs"}
            variant="outline"
            className="gap-1.5"
            aria-label={check ? undefined : "Cancel handoff"}
            onClick={check ?? cancelHandoff}
          >
            {check ? (
              "Check delivery"
            ) : (
              <>
                <X aria-hidden className="size-3" />
                Cancel
              </>
            )}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
