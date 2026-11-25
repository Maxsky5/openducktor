import type { TaskWorkflow, WorkflowIssueTypeId as IssueType } from "@openducktor/workflows";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { type ReactElement, useId } from "react";
import { Badge } from "@/components/ui/badge";
import { OptionCard, OptionCardMark } from "@/components/ui/option-card";
import { WorkflowTrack } from "./workflow-track";
import { type WorkflowTrackModel, workflowTrackModel } from "./workflow-track-model";

function WorkflowOption({
  workflow,
  track,
  isDefault,
  slots,
  onContinue,
}: {
  workflow: TaskWorkflow;
  track: WorkflowTrackModel;
  isDefault: boolean;
  /** The station count of the longest track, which sets the pitch of every track. */
  slots: number;
  onContinue: () => void;
}): ReactElement {
  const nameId = useId();
  const pathId = useId();
  // The mark and the name sit centered on the line of the track.
  return (
    <OptionCard
      value={workflow.reference.id}
      aria-labelledby={nameId}
      aria-describedby={pathId}
      onDoubleClick={onContinue}
      // A radio ignores Enter, so Enter goes on to the details as a double click does.
      onKeyDown={(event) => {
        if (event.key === "Enter") onContinue();
      }}
      className="grid grid-cols-[auto_minmax(0,14rem)_minmax(0,1fr)] items-start gap-x-5 rounded-xl pt-4 pb-3 pr-5 pl-5 focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
    >
      <OptionCardMark className="mt-2" />
      {/* A long name wraps to a second line, so names that start alike stay apart. */}
      <span id={nameId} className="mt-1.5 flex min-w-0 items-start gap-2">
        <span
          className="line-clamp-2 text-sm leading-5 font-semibold text-foreground"
          title={workflow.definition.label}
        >
          {workflow.definition.label}
        </span>
        {isDefault ? (
          <Badge variant="outline" className="shrink-0 px-2 py-0 leading-4 text-muted-foreground">
            Default
          </Badge>
        ) : null}
      </span>
      <WorkflowTrack track={track} slots={slots} />
      <span id={pathId} className="sr-only">
        {track.text}
      </span>
    </OptionCard>
  );
}

/**
 * The workflows that take the picked type, one under the other, each with the track of a new
 * task at the same pitch, so the paths compare at a glance. A double click goes on to the
 * details.
 */
export function WorkflowPicker({
  workflows,
  defaultWorkflowId,
  issueType,
  selectedWorkflowId,
  onSelect,
  onContinue,
}: {
  workflows: readonly TaskWorkflow[];
  defaultWorkflowId: string | undefined;
  issueType: IssueType;
  selectedWorkflowId: string | undefined;
  onSelect: (workflowId: string) => void;
  onContinue: () => void;
}): ReactElement {
  const options = workflows.map((workflow) => ({
    workflow,
    track: workflowTrackModel(workflow, issueType),
  }));
  const slots = Math.max(...options.map(({ track }) => track.stations.length));
  return (
    <RadioGroupPrimitive.Root
      aria-label="Workflows"
      value={selectedWorkflowId ?? ""}
      onValueChange={onSelect}
      className="mt-5 mb-5 flex flex-col gap-2.5"
    >
      {options.map(({ workflow, track }) => (
        <WorkflowOption
          key={workflow.reference.id}
          workflow={workflow}
          track={track}
          isDefault={workflow.reference.id === defaultWorkflowId}
          slots={slots}
          onContinue={onContinue}
        />
      ))}
    </RadioGroupPrimitive.Root>
  );
}
