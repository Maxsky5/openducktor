import { must } from "../../motion/dom";
import { pop, shrinkOut } from "../../motion/effects";
import type { SceneBuilder } from "../../motion/scene";
import { finger } from "../../replicas/mobile/finger";
import { rail } from "../../replicas/mobile/rail";
import { sessionGroups } from "../../replicas/mobile/session-groups";
import { screens } from "../../replicas/mobile/screens";
import { stepList } from "../../replicas/mobile/steps";
import { toolRuns } from "../../replicas/mobile/tool-runs";
import { topButton } from "../../replicas/mobile/top-button";
import { composerActivity } from "../../replicas/shell/composer";
import { transcript } from "../../replicas/transcript/rows";
import { PHONE_SESSIONS, WAITING_BUILD } from "../../sample/mobile";
import { RAIL } from "./sample";

/** The message that the reply brings. The tool runs show their calls as they come. */
const LATER_ROWS = ["passed"];

/**
 * The visitor answers a permission request on the phone. The Sessions tab shows the waiting
 * Builder in Needs you, and the badge counts it. A tap opens the session at its request. Approve
 * once sends the reply: the card goes, and the Builder runs the tests and continues. Back shows
 * the Sessions tab, where the session moves from Needs you to Running, and the badge goes. The
 * markup holds the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const steps = stepList(scene, root);
  const phone = screens(scene, root);
  const tap = finger(scene, root).tap;
  const list = sessionGroups(scene, root);
  const session = phone.screen("session");
  const rows = transcript(scene, session);
  const runs = toolRuns(scene, session);
  const row = (id: string): HTMLElement => must(session, `[data-row="${id}"]`);
  const card = must(session, '[data-request="permission"]');
  const setActivity = composerActivity(session);
  const setRail = rail(session);
  topButton(scene, session);

  // Start: the Builder waits for its permission, and the Sessions tab shows it in Needs you.
  phone.only("sessions");
  list.place(PHONE_SESSIONS);
  card.hidden = false;
  setActivity("waiting");
  setRail("build", RAIL.waiting.build);
  for (const id of LATER_ROWS) row(id).hidden = true;
  runs.later("test", "typecheck");
  scene.at(0.6, () => scene.run(pop(must(root, "[data-tab-badge]"), 1.3)));
  scene.mark("needs-you", 0.6);

  // The visitor opens the session from Needs you.
  steps.show(1, 1.8);
  const opened = tap(() => list.row(WAITING_BUILD), 3.1);
  const shown = phone.push("sessions", "session", opened);
  scene.mark("open", opened);
  scene.mark("request", shown);

  // The visitor reads the request and approves it once. The card fades out when the host takes
  // the reply, and the Builder works again. The space of the pending requests closes with the
  // card, its padding too, so the transcript moves down to its end with no jump.
  steps.show(2, shown + 0.2);
  const approved = tap(() => must(card, '[data-reply="approve_once"]'), shown + 3.4);
  scene.mark("approve", approved);
  scene.at(approved, () => {
    setActivity("working");
    setRail("build", RAIL.working.build);
    scene.run(shrinkOut(must(session, "[data-pending]"), 0.3));
  });

  // The Builder runs the tests and reports. The run of the tests folds when the report comes after
  // it, and the Builder starts the type check.
  steps.show(3, approved + 0.3);
  const tested = runs.call("test", approved + 0.4, 2.4);
  const said = rows.say(row("passed"), tested + 0.3);
  runs.fold("tests", tested + 0.3);
  runs.start("typecheck", said + 0.3);

  // Back shows the Sessions tab. The session leaves Needs you for Running, and the badge goes.
  steps.show(4, said + 1.2);
  const back = tap(() => must(session, "[data-back]"), said + 2.4);
  const returned = phone.pop("session", "sessions", back);
  scene.mark("running", returned);
  list.update(WAITING_BUILD, returned + 0.3, { attention: undefined, unread: false });
  scene.endAt(returned + 3.2);
};
