// The Agent defaults by role section of repository-model-defaults-fields.tsx: a card with its
// header and one row for each role. A row has the role label, Clear, and the model picker trigger
// that sums up the runtime, the model, the effort, and the speed of the role default.
import type { ReactElement, ReactNode } from "react";
import type { ModelChoice } from "../../sample/models";
import { ModelTrigger } from "../models/ModelTrigger";
import { Button } from "../ui/Button";
import "./RoleDefault.css";

/** The default of one role of the built-in workflow. */
export type RoleDefaultData = {
  role: "spec" | "planner" | "build" | "qa";
  label: string;
  value: ModelChoice;
};

/** One role row: flex-col gap-2 rounded-lg border border-border/80 bg-muted/20 p-3. */
export function RoleDefault({
  role,
  label,
  value,
  picker,
}: RoleDefaultData & {
  /** The open model picker under the trigger. */
  picker?: ReactNode;
}): ReactElement {
  return (
    <div className="rd-row" data-role={role}>
      <div className="rd-head">
        <p>{label}</p>
        <Button variant="ghost" size="xs" className="rd-clear">
          Clear
        </Button>
      </div>
      <div className="rd-field">
        <ModelTrigger value={value} variant="form" />
        {picker}
      </div>
    </div>
  );
}

/** The section card, with the header of RepositoryRoleDefaultsHeader in settings. */
export function RoleDefaults({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="rd-section">
      <div className="rd-section-head">
        <div className="rd-section-title" data-section-title="">
          Agent defaults by role
        </div>
        <p>Override the workspace default for specific roles.</p>
      </div>
      <div className="rd-grid">{children}</div>
    </div>
  );
}
