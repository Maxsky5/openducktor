// Typed queries for the page scripts. Each query fails loudly when the markup changed, so a view
// never plays half a scene. This module has no GSAP, so a page without views can use it.

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

/** Reads a data attribute that the scene markup must have. */
export function data(element: HTMLElement, key: string): string {
  const value = element.dataset[key];
  if (value === undefined) throw new Error(`Markup is missing data-${key}.`);
  return value;
}

/** Reads a number from a data attribute that the scene markup must have. */
export function numberData(element: HTMLElement, key: string): number {
  const value = Number(data(element, key));
  if (!Number.isFinite(value)) throw new Error(`Markup has no number in data-${key}.`);
  return value;
}

/** Clones the single root element of a scene template. */
export function cloneTemplate(template: HTMLTemplateElement): HTMLElement {
  const root = template.content.firstElementChild?.cloneNode(true);
  if (!(root instanceof HTMLElement)) throw new Error("A scene template needs one root element.");
  return root;
}
