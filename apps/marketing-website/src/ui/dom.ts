// Typed queries for the page scripts. Each query fails loudly when the markup changed, so a script
// never binds half a control. This module has no GSAP, so a page without scenes can use it.

type ElementClass<T extends Element> = abstract new (...args: never[]) => T;

/** Finds the element that a script needs. It must exist and have the expected class. */
export function must(root: ParentNode, selector: string): HTMLElement;
export function must<T extends Element>(
  root: ParentNode,
  selector: string,
  type: ElementClass<T>,
): T;
export function must(
  root: ParentNode,
  selector: string,
  type: ElementClass<Element> = HTMLElement,
): Element {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Markup is missing ${selector}.`);
  if (!(element instanceof type))
    throw new Error(`Markup has ${selector}, but not as ${type.name}.`);
  return element;
}

/** Finds all the elements of a kind. Each one must have the expected class. */
export function all(root: ParentNode, selector: string): HTMLElement[];
export function all<T extends Element>(
  root: ParentNode,
  selector: string,
  type: ElementClass<T>,
): T[];
export function all(
  root: ParentNode,
  selector: string,
  type: ElementClass<Element> = HTMLElement,
): Element[] {
  return [...root.querySelectorAll(selector)].map((element) => {
    if (!(element instanceof type))
      throw new Error(`Markup has ${selector}, but not as ${type.name}.`);
    return element;
  });
}

/** Reads a number from a data attribute that the markup must have. */
export function numberData(element: HTMLElement, key: string): number {
  const text = element.dataset[key];
  if (text === undefined) throw new Error(`Markup is missing data-${key}.`);
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`Markup has no number in data-${key}.`);
  return value;
}
