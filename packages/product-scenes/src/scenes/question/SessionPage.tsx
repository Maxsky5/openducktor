// The session page of one task session with the right panel closed: the session pane of
// SessionPage.tsx with the workflow rail above the chat column, the docked requests, and the
// composer. The open sidebar leaves the top bar less room, so it keeps only the title, the quick
// action, and the panel toggles. Sources: pages/agents/shell/agents-page-layout.tsx and
// agent-studio-header.tsx in packages/frontend/src.
import { Zap } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Composer } from "../../replicas/studio/Composer";
import type { RailTones } from "../../replicas/studio/model";
import { PanelToggles } from "../../replicas/studio/PanelToggles";
import { SessionHeader, SplitAction, TaskTitle } from "../../replicas/studio/SessionHeader";
import { SessionPane } from "../../replicas/studio/SessionPage";
import { WorkflowRail } from "../../replicas/studio/WorkflowRail";
import { type Activity, type RoleId, WAITING } from "../../replicas/vocabulary";
import type { Session } from "../../sample/sessions";
import type { TaskKey } from "../../sample/tasks";

type SessionPageProps = {
  /** The name that the scene uses to find the page. */
  page: string;
  task: TaskKey;
  tones: RailTones;
  role: RoleId;
  /** The label of the quick action, which an agent at work disables. */
  action: string;
  session: Session;
  activity: Activity;
  hidden?: boolean;
  /** The request cards that dock above the composer. */
  stack?: ReactNode;
  /** The rows of the transcript. */
  children: ReactNode;
};

export function SessionPage({
  page,
  task,
  tones,
  role,
  action,
  session,
  activity,
  hidden = false,
  stack,
  children,
}: SessionPageProps): ReactElement {
  return (
    <SessionPane
      data-page={page}
      data-runtime={session.runtime}
      hidden={hidden}
      header={
        <SessionHeader title={<TaskTitle task={task} />}>
          <SplitAction icon={Zap} label={action} disabled quickAction />
          <PanelToggles right={false} />
        </SessionHeader>
      }
      rail={<WorkflowRail tones={tones} selected={role} />}
      chat={children}
      stack={stack ?? null}
      composer={
        <Composer session={session} activity={activity}>
          <span className="when-waiting" data-waiting="">
            {WAITING.question}
          </span>
        </Composer>
      }
    />
  );
}
