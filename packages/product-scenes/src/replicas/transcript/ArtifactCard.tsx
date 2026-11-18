// The card of an odt_set_task_artifact call that saves a free artifact, from
// agent-chat-artifact-tool-message.tsx: the ODT tool card with the title of readArtifactToolCall in
// artifact-tool-call.ts. While the call runs, the card shows FileText. When the result names a free
// artifact, the card shows File and the Open button, which opens the file in the Artifacts tab.
import { ArrowRight } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import { WorkflowCard } from "./WorkflowCard";

/** The title of the card of a free artifact, as readArtifactToolCall gives it. */
export function artifactCardTitle(name: string): string {
  return `Set Artifact · ${name}`;
}

type ArtifactCardProps = {
  /** The display name of the saved artifact. */
  name: string;
  duration: string;
  time: string;
  row?: string | undefined;
};

export function ArtifactCard({ name, duration, time, row }: ArtifactCardProps): ReactElement {
  return (
    <WorkflowCard
      title={artifactCardTitle(name)}
      icon="free"
      runningIcon="document"
      action={
        <Button variant="outline" size="xs">
          Open
          <ArrowRight />
        </Button>
      }
      duration={duration}
      time={time}
      row={row}
    />
  );
}
