import { must } from "../../motion/dom";
import { pop, shrinkOut } from "../../motion/effects";
import type { SceneBuilder } from "../../motion/scene";
import { finger } from "../../replicas/mobile/finger";
import { rail } from "../../replicas/mobile/rail";
import { sessionGroups } from "../../replicas/mobile/session-groups";
import { screens } from "../../replicas/mobile/screens";
import { stepList } from "../../replicas/mobile/steps";
import { composerActivity } from "../../replicas/shell/composer";
import { follow, transcript } from "../../replicas/transcript/rows";
import { PHONE_SESSIONS, WAITING_BUILD } from "../../sample/mobile";
import { RAIL } from "./sample";

/** The rows that the reply brings. */
const LATER_ROWS = ["test", "passed", "typecheck"];

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
  const row = (id: string): HTMLElement => must(session, `[data-row="${id}"]`);
  const card = must(session, '[data-request="permission"]');
  const setActivity = composerActivity(session);
  const setRail = rail(session);
  follow(scene, must(session, "[data-track]"));

  // Start: the Builder waits for its permission, and the Sessions tab shows it in Needs you.
  phone.only("sessions");
  list.place(PHONE_SESSIONS);
  card.hidden = false;
  setActivity("waiting");
  setRail("build", RAIL.waiting.build);
  for (const id of LATER_ROWS) row(id).hidden = true;
  scene.at(0.6, () => scene.run(pop(must(root, "[data-tab-badge]"), 1.3)));

  // The visitor opens the session from Needs you.
  steps.show(1, 1.8);
  const opened = tap(() => list.row(WAITING_BUILD), 3.1);
  const shown = phone.push("sessions", "session", opened);

  // The visitor reads the request and approves it once. The card fades out when the host takes
  // the reply, and the Builder works again.
  steps.show(2, shown + 0.2);
  const approved = tap(() => must(card, '[data-reply="approve_once"]'), shown + 3.4);
  scene.at(approved, () => {
    setActivity("working");
    setRail("build", RAIL.working.build);
    scene.run(shrinkOut(card, 0.3));
  });

  // The Builder runs the tests, reports, and starts the type check.
  steps.show(3, approved + 0.3);
  const tested = rows.tool(row("test"), approved + 0.4, 2.4);
  const said = rows.say(row("passed"), tested + 0.3);
  rows.start(row("typecheck"), said + 0.3);

  // Back shows the Sessions tab. The session leaves Needs you for Running, and the badge goes.
  steps.show(4, said + 1.2);
  const back = tap(() => must(session, "[data-back]"), said + 2.4);
  const returned = phone.pop("session", "sessions", back);
  list.update(WAITING_BUILD, returned + 0.3, { attention: undefined, unread: false });
  scene.endAt(returned + 3.2);
};
