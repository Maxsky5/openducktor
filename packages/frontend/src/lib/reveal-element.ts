// A transcript that follows its end stops following when a descendant sends this event.
export const REVEAL_ELEMENT_EVENT = "openducktor:reveal-element";

export const revealElement = (target: HTMLElement, behavior: ScrollBehavior = "smooth"): void => {
  target.dispatchEvent(new Event(REVEAL_ELEMENT_EVENT, { bubbles: true }));
  target.scrollIntoView({ behavior, block: "center" });
};
