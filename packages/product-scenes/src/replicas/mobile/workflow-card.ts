// The steps of the workflow tool cards of WorkflowToolCard.tsx in a mobile session. As the
// transcript of the app adds a row, a card shows at once when its call starts, in the colors of a
// running call. When the call ends, the card takes the colors of a call that ended, and the pull
// request that the call saved shows at once: WorkflowToolRow of workflow-tool-row.tsx renders each
// phase without a transition.
import { must } from "../../motion/dom";
import type { Scene } from "../../motion/scene";
import type { WorkflowPhase } from "./WorkflowToolCard";

/** The steps that change the workflow cards. */
type WorkflowCardSteps = {
  later: (row: string) => void;
  call: (row: string, at: number, runs: number) => number;
};

/** The workflow cards in the transcript of the session screen `screen`. */
export function workflowCards(scene: Scene, screen: HTMLElement): WorkflowCardSteps {
  const cardOf = (row: string): HTMLElement =>
    must(screen, `[data-workflow-tool][data-row="${row}"]`);

  /** Build time: the card `row` comes later. */
  const later = (row: string): void => {
    cardOf(row).hidden = true;
  };

  /** The call of the card `row` starts at `at` and runs for `runs` seconds. Returns its end. */
  const call = (row: string, at: number, runs: number): number => {
    const card = cardOf(row);
    scene.at(at, () => {
      card.dataset.phase = "executing" satisfies WorkflowPhase;
      card.hidden = false;
    });
    scene.at(at + runs, () => {
      card.dataset.phase = "completed" satisfies WorkflowPhase;
    });
    return at + runs;
  };

  return { later, call };
}
