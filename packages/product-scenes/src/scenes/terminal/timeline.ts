import { all, must } from "../../motion/dom";
import { designPixel } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { SceneBuilder } from "../../motion/scene";
import { typeText } from "../../motion/text";
import { EASE } from "../../motion/tokens";
import { pointer } from "../../replicas/shell/cursor";
import { keystrokes } from "../../replicas/shell/keystrokes";
import {
  PANEL_OPEN,
  selectTab,
  type SidePanel,
  slideOpen,
} from "../../replicas/studio/side-panels";
import { bottomPanel } from "../../replicas/studio/terminals";
import { tooltip } from "../../replicas/ui/tip";
import { TERMINAL_ACTIONS } from "../../sample/terminal";
import { PANEL_TIPS, TYPED_COMMAND } from "./sample";

/** Seconds that a dropped tab takes to land: horizontalTabDropAnimation in the product. */
const TAB_LAND = 0.22;

/** Seconds that the dragged tab takes from the bottom panel to the right panel. */
const DRAG = 0.85;

/**
 * Seconds after the start of the Test terminal at which each of its lines shows: the output of
 * bun install, then of bun test, then the prompt. Each command line starts after a short wait,
 * and the test results come in small groups.
 */
const TEST_LINES = [
  0, 0.45, 0.5, 0.75, 0.95, 1.3, 1.35, 1.6, 1.8, 1.95, 2.1, 2.2, 2.3, 2.45, 2.55, 2.75, 2.8, 2.85,
  2.9, 3,
];

/**
 * The visitor opens a terminal in the task worktree and runs a repository action. Show bottom
 * panel opens the empty bottom panel, and the panel starts a new terminal. The visitor types a
 * command and presses Enter. Then the default action of the top bar opens a second terminal,
 * named after the action, and its tests pass. Last, the visitor shows the right panel and drags
 * the first terminal there. A phone stage shows one panel at a time, so it has no drag. The
 * markup holds the last frame.
 */
export const build: SceneBuilder = (scene) => {
  const root = must(scene.stage, "[data-root]");
  const bottom: SidePanel = {
    panel: must(root, "[data-bottom-panel]"),
    content: must(root, "[data-bottom-content]"),
    handle: must(root, "[data-bottom-handle]"),
  };
  const right: SidePanel = {
    panel: must(root, "[data-right-panel]"),
    content: must(root, "[data-right-content]"),
    handle: must(root, "[data-right-handle]"),
  };
  const terminals = bottomPanel(scene, root);
  const bottomStrip = must(bottom.panel, '[data-strip="bottom"]');
  const rightStrip = must(right.panel, '[data-strip="right"]');
  const rightBody = must(right.panel, "[data-right-body]");
  const bottomToggle = must(root, '[data-toggle="bottom"]');
  const rightToggle = must(root, '[data-toggle="right"]');
  const runButton = must(root, "[data-repo-run]");
  const restart = must(bottomStrip, "[data-restart]");
  const preview = must(root, "[data-drag]");
  const shellTab = must(rightStrip, '[data-ptab="shell"]');
  const filesTab = must(rightStrip, '[data-ptab="files"]');
  const testTab = must(bottomStrip, '[data-ptab="test"]');
  const term = (id: string): HTMLElement => must(root, `[data-term="${id}"]`);
  const lines = (id: string): HTMLElement[] => all(term(id), "[data-term-line]");
  const input = must(term("shell"), "[data-input]");
  const arrow = must(root, "[data-cursor]", SVGSVGElement);
  const tip = tooltip(root);
  const cursor = pointer(scene, root);
  const keys = keystrokes(scene);
  // A phone stage hides the right panel, as a narrow window shows one panel at a time.
  const showsRight = getComputedStyle(right.panel).display !== "none";

  /** Shows a line of terminal `id`, and its cursor moves to the end of the line. */
  const write = (id: string, line: HTMLElement): void => {
    line.hidden = false;
    line.append(must(term(id), "[data-caret]"));
  };

  // Start: the Builder is done. Both panels and their separators are hidden, the right panel
  // keeps its Diffs tab, and the first terminal waits in the bottom panel.
  testTab.before(shellTab);
  term("test").before(term("shell"));
  rightStrip.removeAttribute("data-fade-start");
  selectTab(rightStrip, rightBody, "diffs");
  for (const part of [right.panel, right.handle, bottom.panel, bottom.handle, testTab])
    part.hidden = true;
  rightToggle.setAttribute("aria-pressed", "false");
  bottomToggle.setAttribute("aria-pressed", "false");
  selectTab(bottomStrip, bottom.content, "shell");
  for (const line of all(root, "[data-term-line]")) line.hidden = true;
  input.textContent = "";

  // The visitor shows the bottom panel. It slides up from the bottom edge, and the chat moves up.
  const pointed = cursor.point(() => bottomToggle, 0.3);
  scene.at(pointed + 0.1, () => tip.show(bottomToggle, PANEL_TIPS.bottom));
  const opened = cursor.click(() => bottomToggle, pointed + 0.7, 0.05);
  scene.at(opened, () => tip.hide());
  terminals.open(opened);
  cursor.hide(opened + 0.4);

  // The empty panel starts a shell in the task worktree. The visitor types a command.
  const [typedLine, ...shellLines] = lines("shell");
  if (!typedLine) throw new Error("The shell terminal has no line for the typed command.");
  scene.at(opened + PANEL_OPEN + 0.1, () => write("shell", typedLine));
  const typed = typeText(scene, input, TYPED_COMMAND, opened + 0.9, { charsPerSecond: 14 });
  const entered = typed + 0.35;
  keys.press(["Enter"], entered, entered + 0.8);
  shellLines.forEach((line, index) => {
    scene.at(entered + 0.05 * (index + 1), () => write("shell", line));
  });

  // The visitor runs the default action of the top bar. Its terminal opens as a new tab at the end
  // of the bottom panel, and zsh runs each command line at the prompt.
  const onRun = cursor.point(() => runButton, entered + 1, 0.9);
  scene.at(onRun + 0.1, () => tip.show(runButton, `Run ${TERMINAL_ACTIONS.test.name}`));
  const ran = cursor.click(() => runButton, onRun + 0.7, 0.05);
  scene.at(ran, () => tip.hide());
  terminals.run("test", ran);
  cursor.hide(ran + 0.4);
  const started = ran + 0.2;
  const testLines = lines("test");
  if (testLines.length !== TEST_LINES.length)
    throw new Error(
      `The Test terminal has ${testLines.length} lines and ${TEST_LINES.length} times.`,
    );
  testLines.forEach((line, index) => {
    scene.at(started + (TEST_LINES[index] ?? 0), () => write("test", line));
  });
  const finished = started + (TEST_LINES.at(-1) ?? 0);
  // Restart shows while a command of the terminal runs.
  scene.at(started, () => {
    restart.hidden = false;
  });
  scene.at(finished, () => {
    restart.hidden = true;
  });
  if (!showsRight) {
    scene.endAt(finished + 3.5);
    return;
  }

  // A tab can only land in a panel that shows, so the visitor first shows the right panel. It
  // slides in from the right edge with its Diffs tab, and the chat gets narrower.
  const onToggle = cursor.point(() => rightToggle, finished + 0.7);
  scene.at(onToggle + 0.1, () => tip.show(rightToggle, PANEL_TIPS.right));
  const shown = cursor.click(() => rightToggle, onToggle + 0.7, 0.05);
  scene.at(shown, () => {
    tip.hide();
    rightToggle.setAttribute("aria-pressed", "true");
    slideOpen(scene, right, "width");
  });

  // The visitor holds the first terminal tab and drags it to the tabs of the right panel. The
  // preview follows the pointer, and the tab keeps its place until the drop. The right strip shows
  // that it accepts the tab while the pointer is over it.
  const held = cursor.point(() => shellTab, shown + 0.8, 0.8) + 0.15;
  scene.at(held, () => {
    const pixel = designPixel(root);
    const from = offsetIn(shellTab, root);
    const files = offsetIn(filesTab, root);
    const tipX = Number(gsap.getProperty(arrow, "x")) + 4;
    const tipY = Number(gsap.getProperty(arrow, "y")) + 3;
    gsap.set(preview, { x: from.x, y: from.y });
    preview.hidden = false;
    // The tab lands after Files when the center of the preview passes the center of Files, as
    // resolvePanelDrop decides. The window clips the end of the preview, as the app window does.
    const grab = tipX - from.x;
    const landX = files.x + filesTab.offsetWidth / 2 + 12 * pixel + grab - preview.offsetWidth / 2;
    const move = { x: landX - tipX, y: files.y + filesTab.offsetHeight / 2 - tipY };
    gsap.set(shellTab, { opacity: 0 });
    scene.run(gsap.to(arrow, { scale: 0.9, duration: 0.1 }));
    const travel = { duration: DRAG, ease: EASE.travel };
    scene.run(gsap.to(arrow, { x: `+=${move.x}`, y: `+=${move.y}`, ...travel }));
    scene.run(gsap.to(preview, { x: `+=${move.x}`, y: `+=${move.y}`, ...travel }));
  });
  scene.at(held + DRAG * 0.7, () => {
    rightStrip.dataset.drop = "accepted";
  });

  // The tab lands after the last tab of the right panel and opens there. The terminal mounts again,
  // and the host restores its screen, so the output stays. The bottom panel keeps its Test tab.
  const dropped = held + DRAG + 0.15;
  scene.at(dropped, () => {
    rightStrip.removeAttribute("data-drop");
    scene.run(gsap.to(arrow, { scale: 1, duration: 0.1 }));
    filesTab.after(shellTab);
    rightBody.append(term("shell"));
    selectTab(rightStrip, rightBody, "shell");
    rightStrip.toggleAttribute("data-fade-start", true);
    gsap.set(shellTab, { opacity: 0 });
    const landing = offsetIn(shellTab, root);
    scene.run(
      gsap.to(preview, {
        x: landing.x,
        y: landing.y,
        duration: TAB_LAND,
        ease: EASE.enter,
        onComplete: () => {
          preview.hidden = true;
          gsap.set(shellTab, { clearProps: "opacity" });
        },
      }),
    );
  });
  cursor.hide(dropped + 0.5);
  scene.endAt(dropped + 3.2);
};
