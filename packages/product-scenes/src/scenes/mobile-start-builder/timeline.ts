import { must } from "../../motion/dom";
import type { SceneBuilder } from "../../motion/scene";
import { boardPager } from "../../replicas/mobile/board-pager";
import { finger } from "../../replicas/mobile/finger";
import { screens } from "../../replicas/mobile/screens";
import { stepList } from "../../replicas/mobile/steps";
import { follow, transcript } from "../../replicas/transcript/rows";
import { FIRST_LANE, READY_LANE } from "./sample";

/** The rows that the Builder adds after the start. */
const LATER_ROWS = ["guide", "shell", "search", "plan", "list"];

/** Seconds that the host takes to start the session. */
const START = 0.9;

/**
 * The visitor starts the Builder from the board. The Tasks tab shows Backlog. Two swipes move the
 * board to Ready for Dev, and the pill, the lane title, and the board wash follow. A tap on Start
 * Builder opens the start sheet. Start session shows the progress on the button, then the sheet
 * closes over the new session, where the Builder reads, searches, and answers. The markup holds
 * the open start sheet over the board on Ready for Dev.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const steps = stepList(scene, root);
  const phone = screens(scene, root);
  const tap = finger(scene, root).tap;
  const pager = boardPager(scene, root);
  const session = phone.screen("session");
  const sheet = phone.screen("start");
  const rows = transcript(scene, session);
  const row = (id: string): HTMLElement => must(session, `[data-row="${id}"]`);
  follow(scene, must(session, "[data-track]"));

  // Start: the board shows Backlog, and the session does not exist yet.
  phone.only("tasks");
  pager.select(FIRST_LANE);
  for (const id of LATER_ROWS) row(id).hidden = true;

  // Two swipes move the board through Spec Ready to Ready for Dev.
  steps.show(1, 1.2);
  const first = pager.swipe(FIRST_LANE, FIRST_LANE + 1, 2.4);
  const ready = pager.swipe(FIRST_LANE + 1, READY_LANE, first + 1);

  // The card of the search shortcut task offers Start Builder, and a tap opens the start sheet.
  steps.show(2, ready + 0.5);
  const tapped = tap(
    () => must(root, '[data-task-card="shortcut"] [data-card-start]'),
    ready + 1.8,
  );
  const opened = phone.present("start", tapped);

  // The visitor checks the choices and starts the session. The button shows the progress.
  steps.show(3, opened + 0.3);
  const button = must(sheet, "[data-start-session]");
  const started = tap(() => button, opened + 3.2);
  scene.at(started, () => button.toggleAttribute("data-loading", true));

  // The host starts the session, and the sheet closes over it.
  const shown = started + START;
  scene.at(shown, () => {
    phone.screen("tasks").hidden = true;
    session.hidden = false;
  });
  const closed = phone.dismiss("start", shown);
  scene.at(closed, () => button.removeAttribute("data-loading"));

  // The Builder reads the guide and the app shell, searches the code, and answers.
  steps.show(4, closed);
  const guide = rows.tool(row("guide"), closed + 0.4, 0.5);
  const shell = rows.tool(row("shell"), guide + 0.3, 0.5);
  const search = rows.tool(row("search"), shell + 0.3, 0.7);
  const said = rows.say(row("plan"), search + 0.4);
  rows.start(row("list"), said + 0.4);
  scene.endAt(said + 3.4);
};
