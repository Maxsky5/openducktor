// The captions of a film: a kicker with the chapter, a title of short lines, and a sentence under
// it. The markup holds every caption, hidden, and the timeline shows one at a time.
import { all, must } from "../../motion/dom";

export type Captions = {
  /** Shows the caption `id` from `at`. Returns the time when its last part shows. */
  show: (id: string, at: number) => number;
  /** Hides the caption `id` from `at`. Returns the time when it is gone. */
  hide: (id: string, at: number, duration?: number) => number;
};

export function captionTrack(timeline: gsap.core.Timeline, root: HTMLElement): Captions {
  const of = (id: string): HTMLElement => must(root, `[data-caption="${id}"]`);
  /** The time span of each caption, so two captions never show together. */
  const spans = new Map<string, { from: number; to: number }>();

  const checkOverlap = (id: string): void => {
    const span = spans.get(id);
    if (!span) return;
    for (const [other, { from, to }] of spans) {
      if (other !== id && span.from < to && from < span.to) {
        throw new Error(
          `The caption ${id} shows from ${span.from.toFixed(2)} s to ${span.to.toFixed(2)} s, while ${other} shows from ${from.toFixed(2)} s to ${to.toFixed(2)} s.`,
        );
      }
    }
  };

  const show = (id: string, at: number): number => {
    spans.set(id, { from: at, to: Number.POSITIVE_INFINITY });
    const caption = of(id);
    const kicker = must(caption, "[data-kicker]");
    const words = all(caption, "[data-word]");
    const sub = must(caption, "[data-sub]");
    // The parts take their first state with the caption, so no part shows before it moves in.
    timeline.set(kicker, { autoAlpha: 0, x: -24 }, at);
    timeline.set(words, { yPercent: 118, rotate: 4 }, at);
    timeline.set(sub, { autoAlpha: 0, y: 16 }, at);
    timeline.set(caption, { autoAlpha: 1, y: 0 }, at);
    timeline.fromTo(
      kicker,
      { autoAlpha: 0, x: -24 },
      { autoAlpha: 1, x: 0, duration: 0.5, ease: "power3.out", immediateRender: false },
      at,
    );
    timeline.fromTo(
      words,
      { yPercent: 118, rotate: 4 },
      {
        yPercent: 0,
        rotate: 0,
        duration: 0.8,
        ease: "power4.out",
        stagger: 0.05,
        immediateRender: false,
      },
      at + 0.08,
    );
    const subAt = at + 0.3 + words.length * 0.05;
    timeline.fromTo(
      sub,
      { autoAlpha: 0, y: 16 },
      { autoAlpha: 1, y: 0, duration: 0.6, ease: "power3.out", immediateRender: false },
      subAt,
    );
    return subAt + 0.6;
  };

  const hide = (id: string, at: number, duration = 0.4): number => {
    const span = spans.get(id);
    if (!span) throw new Error(`The caption ${id} hides before it shows.`);
    span.to = at + duration;
    checkOverlap(id);
    timeline.to(of(id), { autoAlpha: 0, y: -12, duration, ease: "power2.in" }, at);
    return at + duration;
  };

  return { show, hide };
}

/** How a chord of keys comes or goes: a fade, or a cut that swaps it with the next chord at once. */
export type KeyChange = "fade" | "cut";

/** The held keys of a film, which the caption column shows. */
export type KeyCastTrack = {
  /**
   * Shows the chord `id` from `at` until `end`. A chord that follows another one comes and goes
   * with a cut, so the keys that stay down do not blink. The keys at `pressed` go down at `at`.
   */
  show: (
    id: string,
    at: number,
    end: number,
    change?: { enter?: KeyChange; exit?: KeyChange; pressed?: readonly number[] },
  ) => void;
};

export function keyTrack(timeline: gsap.core.Timeline, root: HTMLElement): KeyCastTrack {
  return {
    show: (id, at, end, { enter = "fade", exit = "fade", pressed = [] } = {}) => {
      const row = must(root, `[data-keys="${id}"]`);
      if (enter === "fade") {
        timeline.fromTo(
          row,
          { autoAlpha: 0, y: 10 },
          { autoAlpha: 1, y: 0, duration: 0.2, ease: "power2.out", immediateRender: false },
          at,
        );
      } else {
        timeline.set(row, { autoAlpha: 1, y: 0 }, at);
      }
      const caps = all(row, ".film-key-cap");
      for (const index of pressed) {
        const cap = caps[index];
        if (!cap) throw new Error(`The chord ${id} has no key ${index}.`);
        timeline.fromTo(
          cap,
          { y: 4, scale: 0.94 },
          { y: 0, scale: 1, duration: 0.18, ease: "power2.out", immediateRender: false },
          at,
        );
      }
      if (exit === "fade") {
        timeline.to(row, { autoAlpha: 0, duration: 0.2, ease: "power1.in" }, end - 0.2);
      } else {
        timeline.set(row, { autoAlpha: 0 }, end);
      }
    },
  };
}
