// The popovers of the options bar of a new workspace session. `LocationMenu` is the Combobox of
// the work location in workspace-session-draft-config-bar.tsx: each location with its description,
// the highlight of the item under the pointer, and the check of the selected location.
// `BranchPopover` is DraftNewWorktreePopover of workspace-session-draft-worktree-sections.tsx in
// its New branch mode, with the empty branch name that names the branch from the first message.
// A scene opens them as templates under their triggers with session-draft.ts.
import { Check, ChevronRight } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import { Input } from "../ui/Input";
import { ToggleTabs, ToggleTabsItem } from "../ui/ToggleTabs";
import { WORK_LOCATIONS, type WorkLocation } from "./SessionDraft";
import "./DraftPopovers.css";

/** The words of the branch popover that the product has only in its markup. */
export const BRANCH_TEXT = {
  newBranch: "New branch",
  existingBranch: "Existing branch",
  branchName: "Branch name",
  emptyHint: "Leave empty to name from your first message.",
  customFolder: "Custom folder name",
} as const;

/** The menu of the work location, with `selected` checked and highlighted. */
export function LocationMenu({ selected }: { selected: WorkLocation }): ReactElement {
  return (
    <div className="sd-pop sd-menu" data-location-menu="">
      {WORK_LOCATIONS.map(({ value, label, description, Icon }) => (
        <span
          className="sd-option"
          data-option={value}
          data-active={flag(value === selected)}
          key={value}
        >
          <span className="sd-option-text">
            <span className="sd-option-label">
              <Icon />
              <span>{label}</span>
            </span>
            <span className="sd-option-description">{description}</span>
          </span>
          <Check className="sd-check" data-checked={flag(value === selected)} />
        </span>
      ))}
    </div>
  );
}

/** The branch popover of a new worktree, with the default branch `placeholder`. */
export function BranchPopover({ placeholder }: { placeholder: string }): ReactElement {
  return (
    <div className="sd-pop sd-branch-pop" data-branch-popover="">
      <ToggleTabs className="sd-tabs">
        <ToggleTabsItem checked className="sd-tab">
          {BRANCH_TEXT.newBranch}
        </ToggleTabsItem>
        <ToggleTabsItem className="sd-tab">{BRANCH_TEXT.existingBranch}</ToggleTabsItem>
      </ToggleTabs>
      <div className="sd-field">
        <b>{BRANCH_TEXT.branchName}</b>
        <Input placeholder={placeholder} className="sd-input" data-branch-name="" />
        <p>{BRANCH_TEXT.emptyHint}</p>
      </div>
      <div className="sd-collapsible">
        <span className="sd-folder">
          <ChevronRight />
          <span>{BRANCH_TEXT.customFolder}</span>
        </span>
      </div>
    </div>
  );
}
