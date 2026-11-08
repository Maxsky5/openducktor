// The session page of each workflow step. The stage of a step holds its last frame, and its stock
// holds the templates that its chapter clones. Each step starts where the step before it ends.
import type { ReactElement, ReactNode } from "react";
import { Stock } from "../../frame/Stock";
import { Toast } from "../../replicas/shell/Toast";
import { ToastStack } from "../../replicas/shell/ToastStack";
import { ChecksPanel } from "../../replicas/studio/ChecksPanel";
import { DiffView } from "../../replicas/studio/DiffView";
import { ArtifactPanel } from "../../replicas/studio/ArtifactPanel";
import { GitPanel } from "../../replicas/studio/GitPanel";
import { PullRequestLink } from "../../replicas/studio/PullRequestLink";
import { ReviewComment } from "../../replicas/studio/ReviewComment";
import { StartDialog } from "../../replicas/studio/StartDialog";
import { StudioWindow } from "../../replicas/studio/StudioWindow";
import { ApprovalCard } from "../../replicas/transcript/ApprovalCard";
import { QuestionCard } from "../../replicas/transcript/QuestionCard";
import { Transcript } from "../../replicas/transcript/Transcript";
import { workflowNotification } from "../../replicas/vocabulary";
import { SPEC_QUESTIONS } from "../../sample/question";
import {
  BUILD_FILES,
  BUILDER_FIX_SESSION,
  BUILDER_SESSION,
  CI_CHECKS,
  ARTIFACTS,
  FIXED_FILES,
  FIXED_HOOK_LINES,
  FRAMES,
  PLANNER_SESSION,
  PR_TITLE,
  QA_SESSION,
  REVIEW_COMMENT,
  REVIEWED_HOOK_LINES,
} from "../../sample/studio";
import { TASKS } from "../../sample/tasks";
import { storySessions } from "../../sample/transcripts";
import type { BuildTemplate } from "./build";
import { PlanDocument, QaReport, SpecDocument } from "../../replicas/studio/StoryDocuments";
import type { PlanTemplate } from "./plan";
import type { QaTemplate } from "./qa";
import type { ReviewTemplate } from "./review";
import { type ChapterId, REVIEW_FILES } from "./sample";
import type { SpecTemplate } from "./spec";

/** The stage and the stock of one step. */
export type Step = { Stage: () => ReactElement; Stock: () => ReactElement };

/** The hidden stock of a step, next to its stage. */
function StepStock({ children }: { children: ReactNode }): ReactElement {
  return (
    <div hidden inert data-stock="">
      {children}
    </div>
  );
}

/**
 * Spec: the Spec session saved the specification. The scene docks the question card and answers
 * it.
 */
function SpecStage(): ReactElement {
  return (
    <StudioWindow
      frame={FRAMES.spec}
      panels={{
        document: (
          <ArtifactPanel labels={ARTIFACTS.spec}>
            <SpecDocument />
          </ArtifactPanel>
        ),
      }}
    >
      <Transcript sessions={storySessions([{ id: "spec", turns: 1 }])} shown="spec" />
    </StudioWindow>
  );
}

function SpecStock(): ReactElement {
  return (
    <StepStock>
      <Stock name={"question" satisfies SpecTemplate}>
        <QuestionCard questions={SPEC_QUESTIONS} />
      </Stock>
    </StepStock>
  );
}

/**
 * Plan: the Planner saved the implementation plan. The scene starts on the Spec session, where
 * the Spec chapter ends, opens the start dialog, and plays the Planner session.
 */
function PlanStage(): ReactElement {
  return (
    <StudioWindow
      frame={FRAMES.plan}
      panels={{
        document: (
          <ArtifactPanel labels={ARTIFACTS.plan}>
            <PlanDocument />
          </ArtifactPanel>
        ),
      }}
    >
      <Transcript
        sessions={storySessions([
          { id: "spec", turns: 1 },
          { id: "planner", turns: 1 },
        ])}
        shown="planner"
      />
    </StudioWindow>
  );
}

function PlanStock(): ReactElement {
  return (
    <StepStock>
      <Stock name={"spec-artifact" satisfies PlanTemplate}>
        <div>
          <SpecDocument />
        </div>
      </Stock>
      <Stock name={"planner-dialog" satisfies PlanTemplate}>
        <StartDialog role="Planner" session={PLANNER_SESSION} />
      </Stock>
    </StepStock>
  );
}

/**
 * Build: the Builder committed the change, and the Git panel lists the branch changes. The scene
 * starts on the Planner session, opens the start dialog, and asks for the commit approval. The
 * Builder role saves no artifact, so the session opens the Diffs tab.
 */
function BuildStage(): ReactElement {
  return (
    <StudioWindow
      frame={FRAMES.build}
      panels={{
        document: (
          <ArtifactPanel labels={ARTIFACTS.plan}>
            <PlanDocument />
          </ArtifactPanel>
        ),
        diffs: <GitPanel files={BUILD_FILES} ahead={1} />,
      }}
    >
      <Transcript
        sessions={storySessions([
          { id: "planner", turns: 1 },
          { id: "build", turns: 1 },
        ])}
        shown="build"
      />
    </StudioWindow>
  );
}

function BuildStock(): ReactElement {
  return (
    <StepStock>
      <Stock name={"builder-dialog" satisfies BuildTemplate}>
        <StartDialog role="Builder" session={BUILDER_SESSION} target="origin/main" goal />
      </Stock>
      <Stock name={"approval" satisfies BuildTemplate}>
        <ApprovalCard
          summary="Commit the search shortcut change to the task branch."
          command='git commit -m "feat(search): open search with Cmd+K"'
        />
      </Stock>
    </StepStock>
  );
}

/**
 * QA: the Builder reused its session to fix the QA rejection. The scene starts where the Build
 * chapter ends. You start a fresh QA session, it saves the QA report, and the start dialog of the
 * fix opens in reuse mode.
 */
function QaStage(): ReactElement {
  return (
    <StudioWindow
      frame={FRAMES.qa}
      panels={{
        document: (
          <ArtifactPanel labels={ARTIFACTS.qa}>
            <QaReport />
          </ArtifactPanel>
        ),
        diffs: <GitPanel files={FIXED_FILES} ahead={2} />,
      }}
    >
      <Transcript
        sessions={storySessions([
          { id: "qa", turns: 1 },
          { id: "build", turns: 2 },
        ])}
        shown="build"
      />
    </StudioWindow>
  );
}

function QaStock(): ReactElement {
  return (
    <StepStock>
      <Stock name={"qa-dialog" satisfies QaTemplate}>
        <StartDialog role="QA" session={QA_SESSION} modes={["fresh", "reuse"]} />
      </Stock>
      <Stock name={"fix-dialog" satisfies QaTemplate}>
        <StartDialog
          role="Builder"
          session={BUILDER_FIX_SESSION}
          modes={["fresh", "reuse"]}
          mode="reuse"
          existing="Builder #1"
          goal
        />
      </Stock>
    </StepStock>
  );
}

/**
 * Review: the pull request merged, and the task closed. The scene starts in Human Review on the
 * Builder session. You comment on a diff line and send the comment, the Builder fixes it, and the
 * same session publishes the pull request.
 */
function ReviewStage(): ReactElement {
  return (
    <StudioWindow
      frame={FRAMES.review}
      pr={<PullRequestLink number={42} merged />}
      panels={{
        diffs: (
          <GitPanel
            files={REVIEW_FILES}
            ahead={3}
            pullRequest
            diff={<DiffView lines={REVIEWED_HOOK_LINES} kind="add" />}
          />
        ),
        ci_checks: (
          <ChecksPanel
            title={PR_TITLE}
            updated="10:26:35 AM"
            checks={CI_CHECKS.map((name) => ({ name, state: "success" }))}
          />
        ),
      }}
      overlay={<ToastStack />}
    >
      <Transcript sessions={storySessions([{ id: "build", turns: 4 }])} shown="build" />
    </StudioWindow>
  );
}

function ReviewStock(): ReactElement {
  return (
    <StepStock>
      <Stock name={"old-diff" satisfies ReviewTemplate}>
        <DiffView lines={FIXED_HOOK_LINES} kind="add" />
      </Stock>
      <Stock name={"comment-form" satisfies ReviewTemplate}>
        <ReviewComment />
      </Stock>
      <Stock name={"comment-card" satisfies ReviewTemplate}>
        <ReviewComment text={REVIEW_COMMENT} />
      </Stock>
      <Stock name={"pr-dialog" satisfies ReviewTemplate}>
        <StartDialog
          role="Builder"
          session={BUILDER_FIX_SESSION}
          modes={["reuse", "fork"]}
          mode="reuse"
          existing="Builder #1"
          target="origin/main"
        />
      </Stock>
      <Stock name={"toast-closed" satisfies ReviewTemplate}>
        <Toast {...workflowNotification("closed", TASKS.k3x9.title)} />
      </Stock>
    </StepStock>
  );
}

/** The stage and the stock of each step, by the id of its chapter. */
export const STEPS = {
  spec: { Stage: SpecStage, Stock: SpecStock },
  plan: { Stage: PlanStage, Stock: PlanStock },
  build: { Stage: BuildStage, Stock: BuildStock },
  qa: { Stage: QaStage, Stock: QaStock },
  review: { Stage: ReviewStage, Stock: ReviewStock },
} as const satisfies Record<ChapterId, Step>;
