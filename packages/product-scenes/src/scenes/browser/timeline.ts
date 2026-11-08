import { must } from "../../motion/dom";
import { fadeIn, pop } from "../../motion/effects";
import type { SceneBuilder } from "../../motion/scene";
import { browserTab } from "../../replicas/browser/browsing";
import { sessionPanel } from "../../replicas/browser/session-panel";
import { pointer } from "../../replicas/shell/cursor";
import { keystrokes } from "../../replicas/shell/keystrokes";
import { tooltip } from "../../replicas/ui/tip";
import { BLANK_PAGE, DEV_SERVER, DEV_SERVER_SHORT, PAGE_TITLE } from "../../sample/browser";
import { NEW_TAB_TIP, SHARE_TIPS } from "./sample";

/**
 * The visitor opens a web page in a browser tab. New tab at the end of the panel tabs opens the
 * Open a tab launcher, and Browser opens a blank browser tab in place of the New tab, with the
 * focus in its address bar. The visitor types the address of the dev server and presses Enter.
 * The page loads, and the tab takes the page title and favicon. Last, the visitor turns on Share
 * with agents, and the tab shows the Shared badge. The markup holds the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const panel = sessionPanel(root);
  const cursor = pointer(scene, root);
  const tip = tooltip(root);
  const keys = keystrokes(scene);
  const browser = browserTab(scene, root, cursor);
  const add = must(panel.strip, "[data-strip-add]");
  const newTab = panel.tab("new");
  const browserItem = panel.tab("browser");
  const label = must(browserItem, "[data-bw-tab-label]");
  const card = must(root, '[data-launch="browser"]');
  const share = browser.tool("share");

  // Start: the panel shows the Diffs tab, or a shell on a phone stage, and has no browser tab.
  browserItem.hidden = true;
  browserItem.removeAttribute("data-favicon");
  browserItem.removeAttribute("data-shared");
  label.textContent = BLANK_PAGE;
  // The fade of the strip needs the layout, so it shows with the first frame.
  scene.at(0, () => panel.fit());
  panel.select(panel.narrow ? "shell" : "diffs");
  browser.view.dataset.state = "blank";
  browser.reset();
  must(browser.view, "[data-bw-address]").textContent = "";
  share.setAttribute("aria-pressed", "false");

  // New tab adds a tab at the end of the strip, and its launcher lists the tabs that can open.
  const onAdd = cursor.point(() => add, 0.3);
  scene.at(onAdd + 0.1, () => tip.show(add, NEW_TAB_TIP));
  const added = cursor.click(() => add, onAdd + 0.6, 0.05);
  scene.at(added, () => {
    tip.hide();
    newTab.hidden = false;
    panel.select("new");
    panel.fit();
    scene.run(pop(newTab, 1.06));
  });

  // Browser opens a blank browser tab in place of the New tab. Its address bar takes the focus.
  const onCard = cursor.point(() => card, added + 0.45, 0.7);
  scene.at(onCard - 0.15, () => card.toggleAttribute("data-hover", true));
  const picked = cursor.click(() => card, onCard + 0.35, 0.05);
  scene.at(picked, () => {
    card.removeAttribute("data-hover");
    newTab.hidden = true;
    browserItem.hidden = false;
    panel.select("browser");
    panel.fit();
    browser.focusAddress();
    scene.run(fadeIn(browser.view, 0.2));
  });
  cursor.hide(picked + 0.4);

  // The visitor types the address and presses Enter. The page loads, and the address bar shows
  // the address without its scheme. The tab shows the host until the page gives its title.
  const typed = browser.typeAddress(DEV_SERVER, picked + 0.7, 16);
  const entered = typed + 0.3;
  keys.press(["Enter"], entered, entered + 0.8);
  scene.at(entered, () => {
    browser.load(DEV_SERVER_SHORT);
    browser.view.dataset.state = "loading";
    label.textContent = DEV_SERVER_SHORT;
    panel.fit();
  });
  const loaded = entered + 0.7;
  scene.at(loaded, () => {
    browser.view.dataset.state = "page";
    label.textContent = PAGE_TITLE;
    browserItem.toggleAttribute("data-favicon", true);
    panel.fit();
    scene.run(fadeIn(browser.page, 0.3));
  });

  // Share with agents lets the agents of the task use the tab. The tab shows the Shared badge.
  const onShare = cursor.point(() => share, loaded + 0.8);
  scene.at(onShare + 0.1, () => tip.show(share, SHARE_TIPS.off));
  const shared = cursor.click(() => share, onShare + 0.8, 0.05);
  scene.at(shared, () => {
    share.setAttribute("aria-pressed", "true");
    browserItem.toggleAttribute("data-shared", true);
    panel.fit();
    scene.run(pop(must(browserItem, "[data-bw-badge]"), 1.15));
    tip.show(share, SHARE_TIPS.on);
  });
  scene.at(shared + 1.4, () => tip.hide());
  cursor.hide(shared + 1.5);
  scene.endAt(shared + 4);
};
