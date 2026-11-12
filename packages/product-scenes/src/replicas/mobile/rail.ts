// The workflow rail of MobileRail.tsx in a session screen. A scene sets the state of a step, and
// the connector before the step takes its tone.
import { must } from "../../motion/dom";
import type { RoleId } from "../vocabulary";
import type { RailStep } from "./MobileRail";

/** The setter of the steps of the rail in `screen`. */
export function rail(screen: HTMLElement): (role: RoleId, step: RailStep) => void {
  return (role, step) => {
    const element = must(screen, `[data-step="${role}"]`);
    element.dataset.tone = step.tone;
    element.dataset.mark = step.mark;
    const link = screen.querySelector<HTMLElement>(`[data-link="${role}"]`);
    if (link) link.dataset.tone = step.tone;
  };
}
