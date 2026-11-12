// The browser tab of Browser.tsx, and the steps that change it: the address bar, the toggles of
// the toolbar, the element picker, the comment box of a selection, and the annotation markers.
// The overlays copy browser-page-overlays.tsx and browser-comment-box-position.ts.
import { must } from "../../motion/dom";
import { pop } from "../../motion/effects";
import { gsap } from "../../motion/gsap";
import { offsetIn } from "../../motion/offset";
import type { Scene } from "../../motion/scene";
import { typeText } from "../../motion/text";
import { EASE } from "../../motion/tokens";
import type { Pointer } from "../shell/cursor";

type Box = { x: number; y: number; width: number; height: number };

/** browser-comment-box-position.ts: the box width, its estimated height, and the gap. */
const COMMENT_WIDTH = 320;
const COMMENT_HEIGHT = 240;
const GAP = 8;
/** browser-annotation-markers.tsx: the marker center sits on the top left corner of the element. */
const MARKER_OFFSET = 10;
/** browser-picker-overlay.tsx: the label goes inside the box near the top of the page. */
const LABEL_HEIGHT = 20;

/** An element of the Fieldnotes page, by its `data-fn` name. */
export type PageElement = "notebook-travel" | "empty-title" | "empty-subtitle" | "create-note";

/** The browser tab of a scene and its steps. */
export type BrowserTabSteps = {
  view: HTMLElement;
  page: HTMLElement;
  /** The toolbar button `name`, such as share or annotate. */
  tool: (name: string) => HTMLElement;
  /** Build time: no overlay shows, Annotate is off, and no annotation waits. */
  reset: () => void;
  /** Turns the element picker on or off. */
  annotate: (on: boolean) => void;
  /** The pointer is a crosshair over the page while the picker is on, and an arrow elsewhere. */
  crosshair: (on: boolean) => void;
  /** The address bar takes the focus, with the caret in it. */
  focusAddress: () => void;
  /** Types an address in the focused address bar at `at`. Returns the end time. */
  typeAddress: (text: string, at: number, charsPerSecond: number) => number;
  /** Enter loads the address: the focus moves to the page, and the bar shows the short address. */
  load: (shown: string) => void;
  /**
   * The pointer selects element `name`, and the note goes in its comment box. Save adds marker
   * `n`. Returns the time of the save.
   */
  pick: (name: PageElement, at: number, label: string, note: string, n: number) => number;
  /** The sent annotations leave the page: the markers go, and the count hides. */
  clear: () => void;
};

/** The browser tab in the replica `root`, with the pointer of the scene. */
export function browserTab(scene: Scene, root: HTMLElement, cursor: Pointer): BrowserTabSteps {
  const view = must(root, "[data-bw]");
  const area = must(view, "[data-bw-page]");
  const page = must(view, "[data-fn-page]");
  const address = must(view, "[data-bw-address]");
  const addressBox = must(view, "[data-bw-address-box]");
  const count = must(view, "[data-bw-count]");
  const target = must(view, "[data-bw-target]");
  const targetLabel = must(view, "[data-bw-target-label]");
  const selected = must(view, "[data-bw-selected]");
  const comment = must(view, "[data-bw-comment]");
  const commentLabel = must(view, "[data-bw-comment-label]");
  const commentText = must(view, "[data-bw-comment-text]");
  const save = must(view, "[data-bw-save]");
  const arrow = must(root, "[data-cursor]", SVGSVGElement);
  const tool = (name: string): HTMLElement => must(view, `[data-bw-tool="${name}"]`);
  const marker = (n: number): HTMLElement => must(view, `[data-bw-marker="${n}"]`);
  const element =
    (name: PageElement): (() => HTMLElement) =>
    () =>
      must(page, `[data-fn="${name}"]`);

  /** The box of a page element in pixels of the page area. */
  const boxIn = (part: HTMLElement): Box => {
    const { x, y } = offsetIn(part, area);
    return { x, y, width: part.offsetWidth, height: part.offsetHeight };
  };
  const place = (overlay: HTMLElement, box: Box): void => {
    gsap.set(overlay, { left: box.x, top: box.y, width: box.width, height: box.height });
  };

  const crosshair = (on: boolean): void => {
    if (on) arrow.dataset.shape = "crosshair";
    else delete arrow.dataset.shape;
  };

  const annotate = (on: boolean): void => {
    tool("annotate").setAttribute("aria-pressed", String(on));
    crosshair(on);
  };

  /** Shows the count of pending annotations next to the icon, which hides at zero. */
  const setCount = (n: number): void => {
    count.textContent = n > 0 ? String(n) : "";
    count.hidden = n === 0;
  };

  const reset = (): void => {
    for (const part of [target, selected, comment, marker(1), marker(2)]) part.hidden = true;
    setCount(0);
    annotate(false);
  };

  const focusAddress = (): void => {
    addressBox.toggleAttribute("data-focus", true);
    address.toggleAttribute("data-typing", true);
  };

  const typeAddress = (text: string, at: number, charsPerSecond: number): number =>
    typeText(scene, address, text, at, { charsPerSecond });

  const load = (shown: string): void => {
    addressBox.removeAttribute("data-focus");
    address.removeAttribute("data-typing");
    address.textContent = shown;
  };

  /** The pointer rests on an element, and the picker highlight follows it with its label. */
  const hover = (name: PageElement, at: number, label: string): number => {
    const arrived = cursor.point(element(name), at, 0.55);
    scene.at(arrived - 0.1, () => {
      const box = boxIn(element(name)());
      target.hidden = false;
      target.toggleAttribute("data-inside", box.y < LABEL_HEIGHT);
      targetLabel.textContent = label;
      place(target, box);
      scene.run(gsap.fromTo(target, { opacity: 0.4 }, { opacity: 1, duration: 0.12 }));
    });
    return arrived;
  };

  /** Opens the comment box under the selection, or above it when the page has no room below. */
  const openComment = (box: Box, label: string): void => {
    target.hidden = true;
    selected.hidden = false;
    place(selected, box);
    commentLabel.textContent = label;
    commentText.textContent = "";
    save.toggleAttribute("data-disabled", true);
    comment.hidden = false;
    const below = box.y + box.height + GAP;
    const top =
      below + COMMENT_HEIGHT <= area.clientHeight
        ? below
        : Math.max(GAP, box.y - COMMENT_HEIGHT - GAP);
    const left = Math.max(GAP, Math.min(box.x, area.clientWidth - COMMENT_WIDTH - GAP));
    gsap.set(comment, { left, top, width: COMMENT_WIDTH });
    scene.run(
      gsap.fromTo(
        comment,
        { autoAlpha: 0, y: -6 },
        { autoAlpha: 1, y: 0, duration: 0.22, ease: EASE.arrive },
      ),
    );
  };

  /** Save closes the comment box and adds marker `n` on the element. */
  const addMarker = (box: Box, n: number): void => {
    comment.hidden = true;
    selected.hidden = true;
    const pin = marker(n);
    pin.hidden = false;
    gsap.set(pin, {
      left: Math.max(0, box.x - MARKER_OFFSET),
      top: Math.max(0, box.y - MARKER_OFFSET),
    });
    scene.run(
      gsap.fromTo(
        pin,
        { scale: 0, autoAlpha: 0 },
        { scale: 1, autoAlpha: 1, duration: 0.4, ease: EASE.snap },
      ),
    );
    setCount(n);
    scene.run(pop(count, 1.35));
  };

  const pick = (name: PageElement, at: number, label: string, note: string, n: number): number => {
    const clicked = cursor.click(element(name), hover(name, at, label) + 0.3, 0.05);
    scene.at(clicked + 0.05, () => openComment(boxIn(element(name)()), label));
    scene.at(clicked + 0.35, () => commentText.toggleAttribute("data-typing", true));
    const typed = typeText(scene, commentText, note, clicked + 0.4, { charsPerSecond: 30 });
    scene.at(typed + 0.05, () => {
      commentText.removeAttribute("data-typing");
      save.removeAttribute("data-disabled");
    });
    const saved = cursor.click(() => save, typed + 0.15, 0.45);
    scene.at(saved + 0.08, () => addMarker(boxIn(element(name)()), n));
    return saved + 0.1;
  };

  const clear = (): void => {
    setCount(0);
    for (const n of [1, 2]) marker(n).hidden = true;
  };

  return {
    view,
    page,
    tool,
    reset,
    annotate,
    crosshair,
    focusAddress,
    typeAddress,
    load,
    pick,
    clear,
  };
}
