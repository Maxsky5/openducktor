import { mcpArtifactSaveResultSchema, type McpTaskArtifact } from "@openducktor/contracts";
import {
  ArrowRight,
  File,
  FileText,
  ListChecks,
  LoaderCircle,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { useChatArtifactLinkAction } from "./agent-chat-artifact-link-context";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { WorkflowToolMessage } from "./agent-chat-workflow-tool-message";
import { getToolLifecyclePhase, hasNonEmptyText } from "./tool-lifecycle";

export const ArtifactToolMessage = ({
  meta,
  ...props
}: {
  meta: ToolMeta;
  messageTimestamp: string;
  timeLabel: string;
  sessionWorkingDirectory?: string | null | undefined;
}): ReactElement => {
  const completed = getToolLifecyclePhase(meta) === "completed";
  const saved = useMemo(
    () => (completed ? readSavedArtifact(meta.output) : null),
    [completed, meta.output],
  );
  const code = saved?.code ?? readInputText(meta, "code");
  const verdict =
    saved?.classification === "workflow" ? saved.verdict : readInputText(meta, "verdict");
  const { title, icon } = artifactHeading(code, verdict);
  const name = saved?.name ?? readInputText(meta, "name") ?? code;
  const freeTitle = name ? `Set Artifact · ${name}` : "Set Artifact";

  return (
    <WorkflowToolMessage
      {...props}
      meta={meta}
      displayName={title ?? freeTitle}
      icon={icon}
      action={
        saved?.classification === "free" ? (
          <ArtifactOpenButton key={`${saved.taskId}:${saved.code}`} artifact={saved} />
        ) : null
      }
    />
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

const readInputText = (meta: ToolMeta, field: string): string | null => {
  const value = meta.input?.[field];
  return hasNonEmptyText(value) ? value.trim() : null;
};

const readSavedArtifact = (output: string | undefined): McpTaskArtifact | null => {
  if (!output) return null;
  try {
    const result = mcpArtifactSaveResultSchema.safeParse(JSON.parse(output));
    return result.success ? result.data.artifact : null;
  } catch {
    return null;
  }
};

const artifactHeading = (code: string | null, verdict: string | null | undefined) => {
  if (code === "spec") return { title: "Set Spec", icon: <FileText className="size-3.5" /> };
  if (code === "plan") return { title: "Set Plan", icon: <ListChecks className="size-3.5" /> };
  if (code === "qaReport") {
    if (verdict === "approved")
      return {
        title: "Approve QA",
        icon: <ShieldCheck className="size-3.5" />,
      };
    if (verdict === "rejected")
      return {
        title: "Reject QA",
        icon: <ShieldX className="size-3.5" />,
      };
    return { title: "Set QA Report", icon: <ShieldCheck className="size-3.5" /> };
  }
  return { title: null, icon: <File className="size-3.5" /> };
};
