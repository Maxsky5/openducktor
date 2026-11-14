import type { McpTaskArtifact } from "@openducktor/contracts";
import {
  type ArtifactToolHeading,
  readArtifactToolCall,
  readArtifactToolTaskId,
} from "@openducktor/frontend-core/sessions/messages/artifact-tool-call";
import { ArrowRight, File, FileText, LoaderCircle, ShieldCheck, ShieldX } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { useChatArtifactLinkAction } from "./agent-chat-artifact-link-context";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { WorkflowToolMessage } from "./agent-chat-workflow-tool-message";
import { useChatToolTask } from "./agent-chat-workflow-context";

const HEADING_ICONS = {
  artifact: <FileText className="size-3.5" />,

  document: <FileText className="size-3.5" />,
  review_passed: <ShieldCheck className="size-3.5" />,
  review_failed: <ShieldX className="size-3.5" />,
  review: <ShieldCheck className="size-3.5" />,
  free: <File className="size-3.5" />,
} satisfies Record<ArtifactToolHeading, ReactElement>;

export const ArtifactToolMessage = ({
  meta,
  ...props
}: {
  meta: ToolMeta;
  messageId: string;
  messageTimestamp: string;
  timeLabel: string;
}): ReactElement => {
  const snapshot = useMemo(() => readArtifactToolCall(meta), [meta]);
  const taskId = snapshot.saved?.taskId ?? readArtifactToolTaskId(meta);
  const workflow = useChatToolTask(taskId);
  const { heading, title, saved } = useMemo(
    () => readArtifactToolCall(meta, workflow.task?.taskWorkflow),
    [meta, workflow.task?.taskWorkflow],
  );

  return (
    <>
      <WorkflowToolMessage
        {...props}
        meta={meta}
        displayName={title}
        icon={HEADING_ICONS[heading]}
        action={
          saved?.classification === "free" ? (
            <ArtifactOpenButton key={`${saved.taskId}:${saved.code}`} artifact={saved} />
          ) : null
        }
      />
      {workflow.error ? (
        <p role="alert" className="text-xs text-destructive">
          {workflow.error}
        </p>
      ) : null}
    </>
  );
};

const ArtifactOpenButton = ({ artifact }: { artifact: McpTaskArtifact }): ReactElement | null => {
  const openArtifact = useChatArtifactLinkAction();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!openArtifact) return null;

  const open = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      await openArtifact({ taskId: artifact.taskId, code: artifact.code });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the artifact.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="xs"
        aria-label={`Open ${artifact.name}`}
        aria-busy={pending}
        disabled={pending}
        onClick={() => void open()}
      >
        {pending ? (
          <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
        ) : null}
        {pending ? "Opening…" : "Open"}
        {!pending ? <ArrowRight aria-hidden="true" data-icon="inline-end" /> : null}
      </Button>
      {error ? (
        <p role="alert" className="basis-full text-xs text-destructive-surface-foreground">
          {error}
        </p>
      ) : null}
    </>
  );
};
