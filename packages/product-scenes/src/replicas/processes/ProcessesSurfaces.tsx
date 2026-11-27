// The two surfaces of the Processes view in processes-surfaces.tsx. The flyout opens beside the
// Processes button of the rail, with Detach and Close at the end of its toolbar, and the stop
// confirmation joins it. The floating window of components/ui/floating-window.tsx has its own
// title bar with Attach and Close, and a resize grip in its corner. It opens where the flyout was,
// with its minimum size, FLOATING_MIN_SIZE, at least.
// processes.ts moves them.
import { Cpu, PictureInPicture, PictureInPicture2, X } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "../ui/Button";
import type { ProcessCommand, ProcessGroup } from "./model";
import { PROCESSES_LABELS } from "./model";
import { ProcessesPanel } from "./ProcessesPanel";
import { StopConfirm } from "./StopConfirm";
import "./ProcessesSurfaces.css";

type ProcessesFlyoutProps = {
  groups: readonly ProcessGroup[];
  /** The command whose Stop asks for confirmation in the scene. */
  stopping: ProcessCommand;
};

/** The flyout beside the rail. It is closed in the static frame. */
export function ProcessesFlyout({ groups, stopping }: ProcessesFlyoutProps): ReactElement {
  return (
    <div className="pf" hidden data-processes-flyout="">
      <ProcessesPanel
        groups={groups}
        actions={
          <>
            <span className="pf-rule" />
            <Button variant="ghost" size="icon" className="pf-button" data-detach="">
              <PictureInPicture2 />
            </Button>
            <Button variant="ghost" size="icon" className="pf-button pf-close">
              <X />
            </Button>
          </>
        }
      />
      <StopConfirm command={stopping} />
    </div>
  );
}

/** The floating window over the page, with the list without the buttons of the flyout. */
export function ProcessesWindow({ groups }: { groups: readonly ProcessGroup[] }): ReactElement {
  return (
    <div className="pw" data-processes-window="">
      <div className="pw-title" data-window-title="">
        <Cpu className="pw-icon" />
        <span className="pw-name">{PROCESSES_LABELS.title}</span>
        <span className="pw-actions">
          <Button variant="ghost" size="icon" className="pw-button">
            <PictureInPicture />
          </Button>
          <Button variant="ghost" size="icon" className="pw-button">
            <X />
          </Button>
        </span>
      </div>
      <ProcessesPanel groups={groups} />
      <span className="pw-grip" data-window-grip="" />
    </div>
  );
}
