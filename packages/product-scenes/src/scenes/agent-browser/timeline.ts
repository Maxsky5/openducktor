import { all, must } from "../../motion/dom";
import { fadeIn, pop } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import type { Scene, SceneBuilder } from "../../motion/scene";
import { typeText } from "../../motion/text";
import { agentMarker } from "../../replicas/browser/agent-marker";
import { browserTab } from "../../replicas/browser/browsing";
import { sessionPanel } from "../../replicas/browser/session-panel";
import { composerActivity } from "../../replicas/shell/composer";
import { type Pointer, pointer } from "../../replicas/shell/cursor";
import { follow, transcript } from "../../replicas/transcript/rows";
import { type Tip, tooltip } from "../../replicas/ui/tip";
import { DEV_SERVER_SHORT, PAGE_TITLE } from "../../sample/browser";
import { AGENT_BADGE_TIP, CALL_ORDER, type CallName, SEARCH_QUERY } from "./sample";

/** The time from the end of a call to the start of the next one, so each step reads calmly. */
const PAUSE = 0.9;

/**
 * The Builder checks its work in its own browser tab. Each browser call shows a running Browser
 * card, and the tab icon shows the dot of an agent that acts while the call runs. The open call
 * adds a tab at the end of the panel tabs and selects it. The page loads, and the tab takes the
 * page title and favicon. A snapshot reads the page. A ring pulses on the search field, the query
 * comes in, and Enter keeps the matching note. A ring pulses on the Travel notebook, and the empty
 * notebook shows. The screenshot card shows its Screenshot button. The Builder answers, and the
 * pointer rests on the Agent badge of the toolbar to show its tooltip. A phone stage shows one
 * panel at a time: the visitor opens the panel while the tab opens, and goes back to the chat for
 * the answer. The markup holds the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const panel = sessionPanel(root);
  const cursor = pointer(scene, root);
  const tip = tooltip(root);
  const browser = browserTab(scene, root, cursor);
  const marker = agentMarker(scene, root);
  const track = must(root, "[data-track]");
  const rows = transcript(scene, root);
  const setActivity = composerActivity(root);
  const row = (name: string): HTMLElement => must(track, `[data-row="${name}"]`);
  const tab = panel.tab("browser");
  const label = must(tab, "[data-bw-tab-label]");
  const page = browser.page;
  const search = must(page, '[data-fn="search"]');
  const query = must(search, "[data-fn-query]");
  const notes = all(page, "[data-fn-note]");
  const main = must(page, "[data-fn-main]");
  const badge = must(browser.view, "[data-bw-agent-badge]");
  follow(scene, track);

  // Start: the developer has sent the request, the panel shows the Diffs tab, or the chat on a
  // phone stage, and no browser tab is open.
  tab.hidden = true;
  tab.removeAttribute("data-favicon");
  tab.removeAttribute("data-agent-active");
  label.textContent = DEV_SERVER_SHORT;
  /** The fade of the strip needs the layout, so it changes only while the panel shows. */
  const fit = (): void => {
    if (root.dataset.shows === "panel") panel.fit();
  };
  scene.at(0, fit);
  panel.select(panel.narrow ? "shell" : "diffs");
  panel.show(panel.narrow ? "chat" : "panel");
  browser.reset();
  page.dataset.notebook = "inbox";
  for (const name of ["plan", ...CALL_ORDER, "answer"]) row(name).hidden = true;
  setActivity("working");

  /** The tab icon shows the dot of an agent that acts on the page. */
  const acting = (on: boolean): void => {
    tab.toggleAttribute("data-agent-active", on);
  };

  /** Shows the card of call `name`, which runs from `at` for `runs` seconds. Returns the end. */
  const call = (name: CallName, at: number, runs: number): number => {
    scene.at(at, () => acting(true));
    const end = rows.tool(row(name), at, runs);
    scene.at(end, () => acting(false));
    return end;
  };

  const planned = rows.say(row("plan"), 0.5);

  // The open call adds an agent tab at the end of the panel tabs and selects it. The keyboard
  // focus stays in the chat. The tab shows the host until the page gives its title.
  const opening = planned + 0.4;
  const opened = call("open", opening, 1.3);
  scene.at(opening + 0.1, () => {
    tab.hidden = false;
    panel.select("browser");
    fit();
    browser.view.dataset.state = "loading";
    scene.run(pop(tab, 1.06));
  });
  scene.at(opened - 0.15, () => {
    browser.view.dataset.state = "page";
    label.textContent = PAGE_TITLE;
    tab.toggleAttribute("data-favicon", true);
    fit();
    scene.run(fadeIn(page, 0.3));
  });

  // A phone stage shows the panel with the bottom panel toggle, so the visitor sees the tab.
  let watching = opened;
  if (panel.narrow) {
    const shown = cursor.click(() => must(root, '[data-toggle="bottom"]'), opening + 0.3, 0.8);
    scene.at(shown, () => {
      panel.show("panel");
      panel.fit();
      scene.run(fadeIn(browser.view, 0.25));
    });
    cursor.hide(shown + 0.4);
    watching = Math.max(opened, shown + 0.4);
  }

  // The snapshot reads the accessibility tree of the page. The page does not change.
  const read = call("snapshot", watching + PAUSE, 0.4);

  // The agent types the query in the search field and presses Enter. The list keeps the notes
  // that match the query.
  const typing = read + PAUSE;
  const typed = call("type", typing, 1.4);
  scene.at(typing + 0.15, () => {
    marker.pulse(search, "type");
    search.toggleAttribute("data-focus", true);
    query.toggleAttribute("data-typing", true);
  });
  typeText(scene, query, SEARCH_QUERY, typing + 0.3, { charsPerSecond: 14 });
  scene.at(typed - 0.3, () => {
    for (const note of notes) {
      const title = must(note, "[data-fn-note-title]").textContent ?? "";
      note.hidden = !title.includes(SEARCH_QUERY);
    }
    query.removeAttribute("data-typing");
  });

  // The agent clicks the Travel notebook, and the empty notebook shows. The search field clears.
  const clicking = typed + PAUSE;
  const clicked = call("click", clicking, 0.6);
  scene.at(clicking + 0.15, () => marker.pulse(must(page, '[data-fn="notebook-travel"]'), "click"));
  scene.at(clicking + 0.3, () => {
    page.dataset.notebook = "travel";
    search.removeAttribute("data-focus");
    query.textContent = "";
    for (const note of notes) note.hidden = false;
    scene.run(gsap.fromTo(main, { opacity: 0.4 }, { opacity: 1, duration: 0.35 }));
  });

  // The screenshot call saves a PNG, so its card shows the Screenshot button at the end.
  const shot = call("screenshot", clicked + PAUSE, 0.7);
  scene.at(shot, () => scene.run(pop(must(row("screenshot"), "[data-shot]"), 1.12)));

  // A phone stage shows the chat again with Back to workspace.
  let answering = shot + 0.6;
  if (panel.narrow) {
    const back = cursor.click(() => panel.back, shot + 0.4, 0.8);
    scene.at(back, () => panel.show("chat"));
    cursor.hide(back + 0.4);
    answering = back + 0.4;
  }
  const answered = rows.say(row("answer"), answering);
  scene.at(answered, () => setActivity("idle"));
  if (panel.narrow) {
    scene.endAt(answered + 3);
    return;
  }
  showBadgeTip(scene, cursor, tip, badge, answered + 0.5);
};

/** The pointer rests on the Agent badge of the toolbar, and its tooltip shows. */
function showBadgeTip(
  scene: Scene,
  cursor: Pointer,
  tip: Tip,
  badge: HTMLElement,
  at: number,
): void {
  const onBadge = cursor.point(() => badge, at);
  scene.at(onBadge + 0.1, () => tip.show(badge, AGENT_BADGE_TIP));
  scene.at(onBadge + 2.2, () => tip.hide());
  cursor.hide(onBadge + 2.3);
  scene.endAt(onBadge + 3.3);
}
