// The session page of a task with a pull request, cropped to the top bar, the chat of the Builder,
// and the right panel on the CI Checks tab. The Builder waits for the checks of the pull request.
// The visitor refreshes the tab, and the test check fails. The visitor opens the failed check, and
// the Builder fixes the cause and pushes. Two more refreshes show the new run, then every check
// passing. Sources: task-execution-ci-checks-panel.tsx and its parts in
// packages/frontend/src/components/features/agents, panel-tab-kinds.ts, and messages.pull_request
// in packages/workflows. The markup holds the last frame. A phone stage shows only the panel, as a
// narrow window shows one panel at a time.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { ChecksPanel } from "../../replicas/studio/ChecksPanel";
import { PanelTabs } from "../../replicas/studio/PanelTabs";
import { PullRequestLink } from "../../replicas/studio/PullRequestLink";
import { Composer } from "../../replicas/studio/Composer";
import { SessionPage } from "../../replicas/studio/SessionPage";
import { Paragraph } from "../../replicas/ui/InlineCode";
import { AgentText } from "../../replicas/transcript/AgentText";
import { ToolRow } from "../../replicas/transcript/ToolRow";
import { WorkflowCard } from "../../replicas/transcript/WorkflowCard";
import { signature } from "../../sample/sessions";
import { BUILDER_PR_SESSION, PR_TITLE } from "../../sample/studio";
import { CAUSE, CHECKS, FINAL, PR_NUMBER, READS, ROWS } from "./sample";
import "../../replicas/studio/PanelTabs.css";
import "./view.css";

/** A Bash row of the turn, from ROWS. */
function Bash({ id }: { id: keyof typeof ROWS }): ReactElement {
  const { args, duration, time } = ROWS[id];
  return <ToolRow kind="bash" name="Bash" args={args} duration={duration} time={time} row={id} />;
}

/**
 * The right panel with the tool tabs of the task. CI Checks shows with a linked pull request. The
 * strip scrolls to show its selected tab, so it fades its start.
 */
function RightPanel(): ReactElement {
  return (
    <>
      <PanelTabs active="ci_checks" checks={{}} fadeStart showEnd />
      <div>
        <ChecksPanel title={PR_TITLE} updated={READS.passed.updated} checks={CHECKS} />
      </div>
    </>
  );
}

export function CiChecksView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="ci-checks"
      alt={`The session page of a task with pull request ${PR_NUMBER}. The Builder session waits for the checks of the pull request, and the right panel shows the CI Checks tab: lint and typecheck pass, and test and build are in progress. The developer selects Refresh CI checks. The test check fails, and the tab shows 1 failing. The developer opens the test check, which shows its workflow, its details, and its start and end times. In the chat, the Builder reads the failed log, fixes the hook, runs the tests, and pushes the fix. The developer refreshes the tab again, and the test check runs again. The Builder reports that all 4 required checks pass. A last refresh shows 4 passing.`}
    >
      <SessionPage
        session={BUILDER_PR_SESSION}
        className="ci-window"
        actions={<PullRequestLink number={PR_NUMBER} />}
        chat={
          <>
            <Bash id="checks" />
            <Bash id="publish" />
            <Bash id="create" />
            <WorkflowCard
              title="Set Pull Request"
              icon="pull_request"
              pr={PR_NUMBER}
              duration="52ms"
              time="10:24:44 AM"
              row="set"
            />
            <Bash id="watch" />
            <Bash id="log" />
            <AgentText row="cause">
              <Paragraph text={CAUSE} />
            </AgentText>
            <Bash id="test" />
            <Bash id="push" />
            <Bash id="rewatch" />
            <AgentText signature={signature(BUILDER_PR_SESSION)} worked="5m 31s" row="final">
              <Paragraph text={FINAL} />
            </AgentText>
          </>
        }
        composer={<Composer session={BUILDER_PR_SESSION} />}
        panel={<RightPanel />}
      />
    </SceneFrame>
  );
}
