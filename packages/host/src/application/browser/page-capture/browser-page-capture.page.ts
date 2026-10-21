/**
 * Page code of the annotation capture. The macro in `browser-page-capture.macro.ts` bundles it with
 * bippy when Bun transpiles or bundles the host. The host runs the bundle once for each capture
 * in the main world of the page, because React keeps its fibers on DOM nodes of that world.
 */
import { getSource, normalizeFileName } from "bippy/source";

type PageFiberType = {
  displayName?: string;
  name?: string;
  render?: PageFiberType;
  type?: PageFiberType;
};

/** A React fiber. Its `type` is a component only for the component work tags. */
type PageFiber = {
  tag: number;
  type: PageFiberType | null;
  return: PageFiber | null;
};

type CapturedElement = {
  tag: string;
  text: string;
  openingTag: string;
  selector: string;
  componentChain: string[] | null;
  source: { path: string; line: number; column: number | null } | null;
};

/** React work tags of components: function, class, forwardRef, memo, simple memo. */
const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
const MAX_CHAIN = 12;
const MAX_TEXT = 80;
const MAX_ATTRIBUTE_VALUE = 60;
const MAX_OPENING_TAG = 240;

const fiberOf = (element: Element): PageFiber | null => {
  for (const [key, value] of Object.entries(element)) {
    if (key.startsWith("__reactFiber$")) {
      return value;
    }
  }
  return null;
};

const componentName = (fiber: PageFiber): string | null => {
  const type = fiber.type;
  if (!COMPONENT_TAGS.has(fiber.tag) || type === null) {
    return null;
  }
  const inner = type.render ?? type.type ?? type;
  return type.displayName ?? inner.displayName ?? inner.name ?? type.name ?? null;
};

/** The names of the components that hold the element, nearest first. */
const componentChain = (element: Element): string[] => {
  const names: string[] = [];
  let fiber = fiberOf(element);
  while (fiber && names.length < MAX_CHAIN) {
    const name = componentName(fiber);
    if (name !== null) {
      names.push(name);
    }
    fiber = fiber.return;
  }
  return names;
};

const isUnique = (selector: string): boolean => document.querySelectorAll(selector).length === 1;

const selectorFor = (element: Element): string => {
  const testId = element.getAttribute("data-testid");
  if (testId !== null) {
    const selector = `[data-testid="${CSS.escape(testId)}"]`;
    if (isUnique(selector)) return selector;
  }
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement) {
    if (current.id.length > 0 && isUnique(`#${CSS.escape(current.id)}`)) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    const localName = current.localName;
    const parent: Element | null = current.parentElement;
    const sameTag = parent
      ? Array.from(parent.children).filter((child) => child.localName === localName)
      : [];
    parts.unshift(
      sameTag.length > 1 ? `${localName}:nth-of-type(${sameTag.indexOf(current) + 1})` : localName,
    );
    current = parent;
  }
  return parts.join(" > ");
};

const sourceOf = async (fiber: PageFiber | null): Promise<CapturedElement["source"]> => {
  if (fiber === null) {
    return null;
  }
  try {
    // SAFETY: bippy reads the fields of a React fiber that `fiberOf` took from the DOM node.
    const source = await getSource(fiber as Parameters<typeof getSource>[0]);
    if (source === null || source.lineNumber === undefined) {
      return null;
    }
    return {
      path: normalizeFileName(source.fileName),
      line: source.lineNumber,
      column: source.columnNumber ?? null,
    };
  } catch {
    // A production build or a page without source maps has no source location.
    return null;
  }
};

/** A value on one line, cut to a length. */
const cut = (value: string, max: number): string => {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/**
 * The opening tag of an element, with short attribute values. It leaves out `value`, which can
 * hold a password or a token that the server put in a field.
 */
const openingTagOf = (element: Element): string => {
  const attributes = Array.from(element.attributes)
    .filter((attribute) => attribute.name !== "value")
    .map((attribute) =>
      attribute.value === ""
        ? attribute.name
        : `${attribute.name}="${cut(attribute.value, MAX_ATTRIBUTE_VALUE).replaceAll('"', "&quot;")}"`,
    );
  return cut(`<${[element.localName, ...attributes].join(" ")}>`, MAX_OPENING_TAG);
};

const capture = async (elements: Element[]): Promise<CapturedElement[]> =>
  Promise.all(
    elements.map(async (element) => {
      const chain = componentChain(element);
      return {
        tag: element.localName,
        text: cut(
          element instanceof HTMLElement ? element.innerText : (element.textContent ?? ""),
          MAX_TEXT,
        ),
        openingTag: openingTagOf(element),
        selector: selectorFor(element),
        componentChain: chain.length > 0 ? chain : null,
        // The element's own fiber holds the place of its JSX, inside the first component.
        source: await sourceOf(fiberOf(element)),
      };
    }),
  );

Object.assign(globalThis, { __openducktorPageCapture: capture });
