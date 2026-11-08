import type { IssueType } from "@openducktor/contracts";
import { issueTypeChoices } from "@openducktor/frontend-core/tasks/create/task-composer-options";
import { specPlanBuildWorkflow } from "@openducktor/workflows";
import type { ReactElement } from "react";
import { issueTypeOptions } from "@/components/features/task-composer/constants";
import { cn } from "@/lib/utils";
import {
  ARROW_GAP,
  type DiagramStep,
  HUMAN_REVIEW,
  PADDING,
  SKIP_ROOM,
  STEP_HEIGHT,
  STEP_WIDTH,
  skippedCount,
  stepX,
  TYPE_WIDTH,
  TYPE_X,
  workflowDiagramHeight,
  workflowSteps,
} from "./feature-tour-workflow-layout";

// A diagram of the workflow of issue types that share one workflow, for the tour: the types, then
// each step of the built-in workflow, then Human Review. A step that every type can skip is
// dashed, and an arrow skips the optional steps at the start.

/** A straight arrow from `x1` to `x2` at `y`. */
function Arrow({
  x1,
  x2,
  y,
  dashed,
}: {
  x1: number;
  x2: number;
  y: number;
  dashed: boolean;
}): ReactElement {
  return (
    <>
      <path d={`M${x1} ${y}H${x2 - 6}`} strokeDasharray={dashed ? "4 4" : undefined} />
      <path d={`M${x2 - 8} ${y - 4.5}L${x2} ${y}L${x2 - 8} ${y + 4.5}Z`} fill="currentColor" />
    </>
  );
}

function StepCard({ step, x, y }: { step: DiagramStep; x: number; y: number }): ReactElement {
  const Icon = step.icon;
  const humanReview = step.label === HUMAN_REVIEW.label;
  return (
    <div
      className={cn(
        "absolute flex flex-col items-center justify-center gap-2 rounded-xl border px-2 pt-1 text-center",
        step.optional
          ? "border-dashed border-muted-foreground/70 bg-transparent"
          : "border-border bg-card shadow-sm",
        humanReview && "border-success-border bg-success-surface",
      )}
      style={{ left: x, top: y, width: STEP_WIDTH, height: STEP_HEIGHT }}
    >
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-lg",
          humanReview ? "bg-card text-success-icon" : "bg-muted text-foreground",
          step.optional && "text-muted-foreground",
        )}
      >
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="flex flex-col">
        <span
          className={cn(
            "text-sm font-semibold leading-5",
            step.optional ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {step.label}
        </span>
        <span className="text-[13px] leading-4 text-muted-foreground">{step.job}</span>
      </span>
      {step.optional ? (
        <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-muted-foreground/70 bg-card px-2 text-xs font-medium leading-5 text-muted-foreground">
          Optional
        </span>
      ) : null}
    </div>
  );
}

/** The issue types of the built-in workflow, with the icons and colors of the task composer. */
const ISSUE_TYPE_OPTIONS = issueTypeOptions(issueTypeChoices(specPlanBuildWorkflow));

const LIST_FORMAT = new Intl.ListFormat("en", { type: "conjunction" });

/** The workflow of `issueTypes`, which share one workflow, under the name `label`. */
export function TourWorkflowDiagram({
  issueTypes,
  label,
}: {
  issueTypes: readonly IssueType[];
  label: string;
}): ReactElement {
  const workflow = workflowSteps(issueTypes);
  const skipped = skippedCount(workflow);
  const skippable = skipped > 0;
  const top = PADDING + (skippable ? SKIP_ROOM : 0);
  const middle = top + STEP_HEIGHT / 2;
  const steps: DiagramStep[] = [...workflow, { ...HUMAN_REVIEW, optional: false }];
  const types = ISSUE_TYPE_OPTIONS.filter((option) => issueTypes.includes(option.value));
  const typeEnd = TYPE_X + TYPE_WIDTH + ARROW_GAP;
  // The skip arrow branches off the arrow that leaves the type column.
  const fork = typeEnd + 8;
  const skipTarget = stepX(skipped) + STEP_WIDTH / 2;
  const skipY = PADDING + 8;
  return (
    <div
      className="relative rounded-xl border border-border bg-card"
      style={{ height: workflowDiagramHeight(issueTypes) }}
    >
      {/* The column has the layout of a step. Its bottom padding takes the place of the job line, so
          the label lines up with the step titles. */}
      <div
        className="absolute flex flex-col items-center justify-center gap-2 pb-4 pt-1"
        style={{ left: TYPE_X, top, width: TYPE_WIDTH, height: STEP_HEIGHT }}
      >
        <span className="flex gap-1.5">
          {types.map((type) => {
            const Icon = type.icon;
            return (
              <span
                key={type.value}
                className={cn("flex size-8 items-center justify-center rounded-lg", type.iconClass)}
              >
                <Icon className="size-[18px]" aria-hidden="true" />
              </span>
            );
          })}
        </span>
        <span className="text-sm font-semibold leading-5 text-foreground">{label}</span>
      </div>
      <svg
        aria-hidden="true"
        className="absolute inset-0 size-full overflow-visible text-foreground/45"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {skippable ? (
          <>
            <path d={`M${typeEnd} ${middle}H${fork}`} />
            <Arrow x1={fork} x2={stepX(0) - ARROW_GAP} y={middle} dashed />
          </>
        ) : (
          <Arrow x1={typeEnd} x2={stepX(0) - ARROW_GAP} y={middle} dashed={false} />
        )}
        {steps.slice(1).map((step, index) => (
          <Arrow
            key={step.label}
            x1={stepX(index) + STEP_WIDTH + ARROW_GAP}
            x2={stepX(index + 1) - ARROW_GAP}
            y={middle}
            dashed={index < skipped}
          />
        ))}
        {skippable ? (
          <>
            <path
              d={`M${fork} ${middle}V${skipY + 10}Q${fork} ${skipY} ${fork + 10} ${skipY}H${skipTarget - 10}Q${skipTarget} ${skipY} ${skipTarget} ${skipY + 10}V${top - 10}`}
            />
            <path
              d={`M${skipTarget - 4.5} ${top - 12}L${skipTarget} ${top - 4}L${skipTarget + 4.5} ${top - 12}Z`}
              fill="currentColor"
            />
          </>
        ) : null}
      </svg>
      {skippable ? (
        <span
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/25 bg-card px-2.5 py-0.5 text-xs font-medium text-foreground"
          style={{ left: (stepX(0) + stepX(skipped - 1) + STEP_WIDTH) / 2, top: skipY }}
        >
          {`Skip ${LIST_FORMAT.format(workflow.slice(0, skipped).map((step) => step.label))}`}
        </span>
      ) : null}
      {steps.map((step, index) => (
        <StepCard key={step.label} step={step} x={stepX(index)} y={top} />
      ))}
    </div>
  );
}
