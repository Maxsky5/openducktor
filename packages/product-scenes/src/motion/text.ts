// Text steps of the scenes: typed input, streamed model output, and counters.
import { all } from "./dom";
import { pop } from "./effects";
import { gsap } from "./gsap";
import type { Scene } from "./scene";
import { EASE } from "./tokens";

/** Deterministic noise, so every loop streams text with the same rhythm. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/** Wraps each word in a span. Hidden words do not take space, so blocks grow as they stream. */
function splitWords(root: HTMLElement): HTMLElement[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node instanceof Text && node.data.trim()) nodes.push(node);
  }
  const words: HTMLElement[] = [];
  for (const node of nodes) {
    const fragment = document.createDocumentFragment();
    const lead = node.data.match(/^\s+/)?.[0];
    if (lead) fragment.append(lead);
    for (const token of node.data.trim().match(/\S+\s*/g) ?? []) {
      const word = document.createElement("span");
      word.textContent = token;
      fragment.append(word);
      words.push(word);
    }
    const trail = node.data.match(/\S(\s+)$/)?.[1];
    if (trail) fragment.append(trail);
    node.replaceWith(fragment);
  }
  return words;
}

/** The blocks of a streamed message: its paragraphs and its list items. */
const BLOCKS = "p, li";

/**
 * Streams the text of `root` in short bursts, like a model response. Block elements appear with
 * their first word. The text hides at build time. Returns the end time.
 */
export function stream(scene: Scene, root: HTMLElement, at: number, wordsPerSecond = 26): number {
  const words = splitWords(root);
  const blocks = all(root, BLOCKS);
  for (const piece of [...blocks, ...words]) piece.hidden = true;
  root.hidden = true;
  scene.at(at, () => {
    root.hidden = false;
  });
  const random = seeded(words.length + 7);
  let time = at + 0.05;
  for (let index = 0; index < words.length;) {
    const size = 1 + Math.floor(random() * 3);
    const group = words.slice(index, index + size);
    const opened = blocks.filter((block) => group.some((word) => block.contains(word)));
    scene.at(time, () => {
      for (const piece of [...opened, ...group]) piece.hidden = false;
    });
    time += (size / wordsPerSecond) * (0.55 + random() * 0.9);
    index += size;
  }
  return time;
}

/** How a text shows while it is typed. */
export type Typing = {
  charsPerSecond?: number;
  /** Gets each new text, for a view that shows more than the typed text. */
  onText?: (text: string) => void;
};

/** Types `text` into `element` at a human pace. The element is empty at build time. Returns the end time. */
export function typeText(
  scene: Scene,
  element: HTMLElement,
  text: string,
  at: number,
  { charsPerSecond = 24, onText }: Typing = {},
): number {
  const progress = { chars: 0 };
  const duration = text.length / charsPerSecond;
  element.textContent = "";
  onText?.("");
  scene.timeline.to(
    progress,
    {
      chars: text.length,
      duration,
      ease: EASE.steady,
      onUpdate: () => {
        const shown = text.slice(0, Math.round(progress.chars));
        if (element.textContent === shown) return;
        element.textContent = shown;
        onText?.(shown);
      },
    },
    at,
  );
  return at + duration;
}

/** How a counter shows its number. */
export type Counting = { duration?: number; prefix?: string };

/**
 * Counts a number from its text to `to`. The text starts with `prefix`, such as "+". The count
 * reads its start value when it starts, so several counts can follow on one element.
 */
export function countTo(
  scene: Scene,
  element: HTMLElement,
  to: number,
  at: number,
  { duration = 0.5, prefix = "" }: Counting = {},
): void {
  scene.at(at, () => {
    const value = { n: Number(element.textContent.slice(prefix.length)) };
    scene.run(
      gsap.to(value, {
        n: to,
        duration,
        ease: EASE.gentle,
        onUpdate: () => {
          element.textContent = `${prefix}${Math.round(value.n)}`;
        },
      }),
    );
    scene.run(pop(element, 1.25).duration(0.16));
  });
}
