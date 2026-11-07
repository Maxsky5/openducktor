// The workflow rail of a task session in agent-studio-header-workflow-rail.tsx: one step for each
// role, above the chat column. A step shows the role icon, its label, and the icon of its state.
// The compact rail is WorkflowRailPreview, in the session preview of the sidebar.
import {
  Check,
  ChevronRight,
  Circle,
  CircleDashed,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import type { ReactElement } from "react";
import { RoleIcon } from "../ui/RoleIcon";
import { ROLE_LABELS, ROLES, type RoleId } from "../vocabulary";
import type { RailTones } from "./model";
import "./WorkflowRail.css";

type WorkflowRailProps = { tones: RailTones; selected: RoleId; compact?: boolean };

export function WorkflowRail({
  tones,
  selected,
  compact = false,
}: WorkflowRailProps): ReactElement {
  return (
    <div className="wr" data-size={compact ? "compact" : undefined}>
      <div className="wr-steps">
        {ROLES.map((role, index) => {
          const next = ROLES[index + 1];
          return (
            <span className="wr-item" key={role}>
              <span
                className="st-step"
                data-step={role}
                data-tone={tones[index]}
                aria-pressed={role === selected ? "true" : "false"}
              >
                <RoleIcon role={role} className="st-step-icon" />
                {ROLE_LABELS[role]}
                <span className="st-step-state">
                  <Check className="i14 done" />
                  <LoaderCircle className="i14 spin working" />
                  <CircleDashed className="i14 waiting" />
                  <TriangleAlert className="i14 alert" />
                  <Circle className="i12 available" />
                </span>
              </span>
              {next && (
                <ChevronRight className="st-link" data-link={next} data-tone={tones[index + 1]} />
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
