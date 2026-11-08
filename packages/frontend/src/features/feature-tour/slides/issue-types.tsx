import { issueTypeChoices } from "@openducktor/frontend-core/tasks/create/task-composer-options";
import { specPlanBuildWorkflow } from "@openducktor/workflows";
import type { ReactElement } from "react";
import { IssueTypeGrid } from "@/components/features/task-composer/issue-type-grid";
import { noop } from "../feature-tour-samples";
import {
  type FeatureTourSlide,
  type TourPart,
  TourPiece,
  TourStageCaption,
} from "../feature-tour-stage";
import { TourWorkflowDiagram } from "../feature-tour-workflow-diagram";
import { workflowDiagramHeight } from "../feature-tour-workflow-layout";

// Slide 3: the type of a new task, and the workflow of each type.

const PARTS: readonly TourPart[] = [
  {
    title: "Feature",
    text: "Add or improve a feature. It runs all five steps.",
    pin: { x: 162, y: 45, side: "top" },
  },
  {
    title: "Bug",
    text: "Fix something that does not work. Spec and Planner are optional.",
    pin: { x: 450, y: 45, side: "top" },
  },
  {
    title: "Task",
    text: "General work or upkeep. It has the workflow of a bug.",
    pin: { x: 738, y: 45, side: "top" },
  },
];

const ISSUE_TYPE_CHOICES = issueTypeChoices(specPlanBuildWorkflow);
const WIDTH = 900;
const FEATURE_TYPES = ["feature"] as const;
const BUG_TYPES = ["bug", "task"] as const;
const FEATURE_DIAGRAM_Y = 272;
const BUG_DIAGRAM_Y = FEATURE_DIAGRAM_Y + workflowDiagramHeight(FEATURE_TYPES) + 56;
const HEIGHT = BUG_DIAGRAM_Y + workflowDiagramHeight(BUG_TYPES);

function IssueTypesStage(): ReactElement {
  return (
    <>
      <TourStageCaption y={0}>Create task</TourStageCaption>
      <TourPiece x={0} y={26} width={WIDTH} height={190}>
        <div className="px-6">
          <IssueTypeGrid
            choices={ISSUE_TYPE_CHOICES}
            selectedIssueType={null}
            onSelectIssueType={noop}
          />
        </div>
      </TourPiece>
      <TourStageCaption y={FEATURE_DIAGRAM_Y - 26}>The workflow of a feature</TourStageCaption>
      <div className="absolute inset-x-0" style={{ top: FEATURE_DIAGRAM_Y }}>
        <TourWorkflowDiagram issueTypes={FEATURE_TYPES} label="Feature" />
      </div>
      <TourStageCaption y={BUG_DIAGRAM_Y - 26}>The workflow of a bug or a task</TourStageCaption>
      <div className="absolute inset-x-0" style={{ top: BUG_DIAGRAM_Y }}>
        <TourWorkflowDiagram issueTypes={BUG_TYPES} label="Bug or task" />
      </div>
    </>
  );
}

export const issueTypesSlide: FeatureTourSlide = {
  id: "issue-types",
  title: "Features, bugs, and tasks",
  text: "Choose a type when you create a task. A feature runs every step of the workflow. A bug or a task can skip Spec and Planner and start at the Builder. All three types end with QA and your review.",
  explainer: {
    width: WIDTH,
    height: HEIGHT,
    listTop: 26,
    parts: PARTS,
    stage: <IssueTypesStage />,
  },
};
