import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { approvalChoices } from "../../replicas/mobile/approval-choices";
import { finger } from "../../replicas/mobile/finger";
import { menus } from "../../replicas/mobile/menus";
import { rail } from "../../replicas/mobile/rail";
import { APPROVE_ACTION } from "../../replicas/mobile/review-actions";
import { screens } from "../../replicas/mobile/screens";
import { stepList } from "../../replicas/mobile/steps";
import { toolRuns } from "../../replicas/mobile/tool-runs";
import { topButton } from "../../replicas/mobile/top-button";
import { workflowCards } from "../../replicas/mobile/workflow-card";
import { composerActivity } from "../../replicas/shell/composer";
import { transcript } from "../../replicas/transcript/rows";
import type { RailStep } from "../../replicas/mobile/MobileRail";
import { type Activity, ROLES, type RoleId } from "../../replicas/vocabulary";
import { REVIEW_RAIL } from "../../sample/mobile-review";
import { RUNS, WORKING_RAIL } from "./sample";

/** Seconds that the approval reads the task details. Its loader shows at least 500 ms. */
const DETAILS = 0.6;

/** Seconds that the host takes to send the pull request prompt to the reused session. */
const SEND = 0.9;

/** The rows of the pull request turn that come after the prompt, as the Builder writes them. */
const LATER_ROWS = ["plan", "save", "worked", "report"];

/** Shows the state of the session in `screen`: its workflow rail and its composer. */
function sessionState(
  screen: HTMLElement,
  steps: Readonly<Record<RoleId, RailStep>>,
  activity: Activity,
): void {
  const setStep = rail(screen);
  for (const role of ROLES) setStep(role, steps[role]);
  composerActivity(screen)(activity);
}

/**
 * The visitor approves the task from its Builder session with a pull request that the Builder
 * writes. Quick Actions opens under the zap button, and Approve Task opens the approval sheet,
 * which shows its loader while it reads the task details. The approval shows Pull request, with
 * Ask Builder chosen. A tap on Ask Builder keeps it, and Choose Builder session changes the sheet
 * to the start of the pull request launch at once. Start session shows the progress on the button
 * while the host sends the prompt to the latest Builder session. The sheet fades out, and the app
 * pushes that session over the same session under the sheet. The Builder says what it does and
 * runs its commands in one tool run. Its next message folds the run, and the Set Pull Request card
 * comes after it and shows PR #42 when the call ends. The last reply ends the turn: the separator,
 * the footer, the idle composer, and the done rail show together. The markup holds the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const steps = stepList(scene, root);
  const phone = screens(scene, root);
  const tap = finger(scene, root).tap;
  const menu = menus(scene, root);
  const approval = approvalChoices(scene, root);
  const session = phone.screen("session");
  const builder = phone.screen("pull-request");
  const start = phone.screen("start");
  topButton(scene, session);
  topButton(scene, builder);
  const runs = toolRuns(scene, builder);
  const cards = workflowCards(scene, builder);
  const rows = transcript(scene, builder);
  const row = (screen: HTMLElement, id: string): HTMLElement => must(screen, `[data-row="${id}"]`);

  // Start: the Builder session of the task in Human Review. The session that the app pushes later
  // shows the prompt of the pull request turn, and the Builder works in it.
  phone.only("session");
  approval.show("pull_request", "merge_commit");
  sessionState(builder, WORKING_RAIL, "working");
  runs.later(...RUNS.publish);
  cards.later("set-pull-request");
  for (const id of LATER_ROWS) row(builder, id).hidden = true;

  // The zap button opens Quick Actions, and Approve Task opens the approval sheet. On Android, the
  // chosen action opens its sheet at once, while the menu fades over it. The sheet shows its
  // loader until the approval has read the task details.
  steps.show(1, 1.0);
  const zap = (): HTMLElement => must(session, "[data-quick-actions]");
  const opened = menu.open("quick", zap, tap(zap, 2.2));
  const item = menu.item("quick", APPROVE_ACTION);
  const chosen = tap(() => item, opened + 1.4);
  menu.close("quick", chosen);
  scene.at(chosen, () => approval.sheet.toggleAttribute("data-preparing", true));
  const presented = phone.present("approve", chosen);
  scene.mark("approve", presented);
  const loaded = chosen + DETAILS;
  scene.at(loaded, () => approval.sheet.removeAttribute("data-preparing"));

  // The approval shows Pull request, and the draft that the Builder writes is the first choice. A
  // tap on Ask Builder keeps it, and the note says that the next step chooses the session. Choose
  // Builder session opens the start of the pull request launch in the same sheet, at once.
  steps.show(2, loaded + 0.2);
  const asked = tap(() => must(approval.sheet, '[data-option="generate_ai"]'), loaded + 1.4);
  scene.mark("draft", asked);
  const confirmed = tap(() => must(approval.sheet, "[data-choose-session]"), asked + 1.7);
  scene.at(confirmed, () => {
    approval.sheet.hidden = true;
    start.hidden = false;
  });
  scene.mark("confirm", confirmed);

  // The visitor checks the choices and starts the session. The button shows the progress, the
  // start disables the other controls of the sheet, and Run in background becomes Continue in
  // background. A reuse sets up no worktree, so the sheet shows no startup trace.
  steps.show(3, confirmed + 0.2);
  const button = must(start, "[data-start-session]");
  const started = tap(() => button, confirmed + 3.4);
  phone.busy("start", button, started);

  // The host sends the pull request prompt to the latest Builder session, which starts its turn.
  // The session under the sheet shows it too. The sheet fades out, and the app pushes the session.
  const sent = started + SEND;
  scene.at(sent, () => {
    row(session, "request").hidden = false;
    sessionState(session, WORKING_RAIL, "working");
  });
  phone.dismiss("start", sent);
  const arrived = phone.push("session", "pull-request", sent);
  scene.mark("session", arrived);

  // The Builder says what it does, then runs the tests, pushes the branch, and creates the pull
  // request in one tool run. Its next message folds the run. The Set Pull Request card comes after
  // the run has folded, and it shows the pull request when the call ends, two seconds later, so no
  // row comes while the pull request shows.
  steps.show(4, arrived + 0.2);
  rows.say(row(builder, "plan"), arrived + 0.7);
  const tested = runs.call("suite", arrived + 1.6, 2.2);
  const pushed = runs.call("push", tested + 0.5, 1.1);
  const proposed = runs.call("create", pushed + 0.5, 1.6);
  const saying = proposed + 0.6;
  rows.say(row(builder, "save"), saying);
  runs.fold("publish", saying);
  const created = cards.call("set-pull-request", saying + 1.3, 2.1);
  scene.mark("created", created);

  // The last reply ends the turn. Its first line names the pull request. When the turn ends, the
  // separator, the footer, the idle composer, and the done rail show together.
  const reported = created + 0.7;
  scene.mark("report", reported);
  const said = rows.say(row(builder, "report"), reported);
  scene.at(said, () => {
    row(builder, "worked").hidden = false;
    sessionState(builder, REVIEW_RAIL, "idle");
  });
  scene.mark("done", said);
  scene.endAt(said + 3.4);
};
