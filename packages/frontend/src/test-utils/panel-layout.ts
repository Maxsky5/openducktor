const LAYOUT_PROPERTIES = ["offsetWidth", "offsetHeight", "offsetLeft", "offsetTop"] as const;

type LayoutProperty = (typeof LAYOUT_PROPERTIES)[number];

const isShown = (element: Element): boolean =>
  element.closest('[hidden], [style*="display: none"]') === null;

const panelSize = (element: Element): number =>
  element.hasAttribute("data-panel") && isShown(element) ? 500 : 0;

/** Places a shown child of a group after the shown children before it, as a flex line does. */
const groupOffset = (element: HTMLElement, axis: "row" | "column"): number => {
  const group = element.parentElement;
  if (!group?.hasAttribute("data-group") || !isShown(element)) return 0;
  if ((group.style.flexDirection === "column" ? "column" : "row") !== axis) return 0;
  let offset = 0;
  for (const sibling of group.children) {
    if (sibling === element) break;
    offset += panelSize(sibling);
  }
  return offset;
};

const LAYOUT_GETTERS = {
  offsetWidth: panelSize,
  offsetHeight: panelSize,
  offsetLeft: (element: HTMLElement) => groupOffset(element, "row"),
  offsetTop: (element: HTMLElement) => groupOffset(element, "column"),
} satisfies Record<LayoutProperty, (element: HTMLElement) => number>;

/**
 * Gives each resizable panel a size while no ancestor hides it, and places the children of each
 * group in a line, as a browser lays out a page. The resizable panels library measures a group
 * from its panel sizes, and orders its panels and separators by their offsets. A group with no
 * size, as in the test DOM, defers its layout and ignores size changes. A hidden element has no
 * offset. Returns a function that removes the layout.
 */
export const installPanelLayout = (): (() => void) => {
  const originals = LAYOUT_PROPERTIES.map((property) => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, property);
    if (!descriptor) throw new Error(`Expected the ${property} property.`);
    return [property, descriptor] as const;
  });
  for (const property of LAYOUT_PROPERTIES) {
    const getLayout = LAYOUT_GETTERS[property];
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get(this: HTMLElement) {
        return getLayout(this);
      },
    });
  }
  return () => {
    for (const [property, descriptor] of originals) {
      Object.defineProperty(HTMLElement.prototype, property, descriptor);
    }
  };
};
