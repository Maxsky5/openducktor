// The session start sheet of the mobile app for a launch with one start mode, such as Start
// Builder, as session-start-sheet.tsx and session-start-form.tsx in
// apps/mobile/src/features/workflow/start-session: the title names the role, and the lead names
// the one start mode, so the sheet shows no Session mode control. Then the target branch, the
// runtime and model, the effort and speed tracks, the Goal mode switch of a launch with a goal, and
// the switch that customizes the first message. The footer holds Run in background above Cancel and
// Start session. The title and the lead follow use-session-start-modal-coordinator.ts in
// packages/frontend-core.
import { GitBranch, Layers, Play, ZapOff } from "lucide-react";
import type { ReactElement } from "react";
import type { Session } from "../../sample/sessions";
import { modelName } from "../../sample/models";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import type { Role } from "../vocabulary";
import { FormField, SelectTrigger, SwitchCard } from "./FormRows";
import { StepSlider } from "./StepSlider";
import { SheetButton, WorkflowSheet } from "./WorkflowSheet";
import "./StartSessionSheet.css";

/** The labels of the runtimes, as the runtime descriptors name them. */
const RUNTIME_LABELS = { codex: "Codex", claude: "Claude", opencode: "OpenCode" } as const;

/** The fixed text of the start sheet. */
export const START_SHEET_TEXT = {
  freshLead: "Start a new session.",
  targetBranch: "Target branch",
  targetBranchHint: "Use this branch as the merge target.",
  speedHint: "Higher levels may cost more. Applies to the next turn.",
  goalMode: "Goal mode",
  goalModeDescription:
    "The agent gets a goal instead of a first message, and works until the goal is met.",
  customize: "Customize first message",
  customizeDescription: "Replace the first message that this action sends to the agent.",
  runInBackground: "Run in background",
  confirm: "Start session",
} as const;

type StartSessionSheetProps = {
  role: Role;
  session: Session;
  /** The target branch, as the branch picker names it. */
  target: string;
  /** The effort levels of the model. */
  efforts: readonly string[];
  /** The launch offers Goal mode, such as Start Implementation. */
  goal?: boolean;
  hidden?: boolean | undefined;
};

export function StartSessionSheet({
  role,
  session,
  target,
  efforts,
  goal = false,
  hidden,
}: StartSessionSheetProps): ReactElement {
  const model = modelName(session);
  return (
    <WorkflowSheet
      id="start"
      title={`Start ${role} session`}
      intro={<p className="mob-fsheet-lead">{START_SHEET_TEXT.freshLead}</p>}
      hidden={hidden}
      secondary={
        <span className="mob-start-background">
          <Layers />
          {START_SHEET_TEXT.runInBackground}
        </span>
      }
      primary={
        <SheetButton
          variant="filled"
          Icon={Play}
          label={START_SHEET_TEXT.confirm}
          data-start-session=""
        />
      }
    >
      <FormField label={START_SHEET_TEXT.targetBranch} hint={START_SHEET_TEXT.targetBranchHint}>
        <SelectTrigger value={target} leading={<GitBranch />} mono />
      </FormField>
      <FormField label="Runtime and model">
        <SelectTrigger
          value={model}
          detail={RUNTIME_LABELS[session.runtime]}
          leading={<RuntimeIcon kind={session.runtime} />}
        />
      </FormField>
      <FormField label="Effort" value={session.effort}>
        <StepSlider stops={efforts.length} value={efforts.indexOf(session.effort)} fill="effort" />
      </FormField>
      {session.speed && (
        <FormField label="Speed" value="Standard" hint={START_SHEET_TEXT.speedHint}>
          <StepSlider stops={2} value={0} fill="standard" mark={<ZapOff />} />
        </FormField>
      )}
      {goal && (
        <SwitchCard
          label={START_SHEET_TEXT.goalMode}
          description={START_SHEET_TEXT.goalModeDescription}
          on={false}
        />
      )}
      <SwitchCard
        label={START_SHEET_TEXT.customize}
        description={START_SHEET_TEXT.customizeDescription}
        on={false}
      />
    </WorkflowSheet>
  );
}
