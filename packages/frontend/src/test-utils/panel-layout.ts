const SIZE_PROPERTIES = ["offsetWidth", "offsetHeight"] as const;

/**
 * Gives each resizable panel a size while no ancestor hides it, as a browser lays out a page. The
 * resizable panels library measures a group from its panel sizes. A group with no size, as in the
 * test DOM, defers its layout and ignores size changes. Returns a function that removes the sizes.
 */
export const installPanelLayout = (): (() => void) => {
  const originals = SIZE_PROPERTIES.map((property) => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, property);
    if (!descriptor) throw new Error(`Expected the ${property} property.`);
    return [property, descriptor] as const;
  });
  for (const property of SIZE_PROPERTIES) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get(this: HTMLElement) {
        const isShown = this.closest('[hidden], [style*="display: none"]') === null;
        return this.hasAttribute("data-panel") && isShown ? 500 : 0;
      },
    });
  }
  return () => {
    for (const [property, descriptor] of originals) {
      Object.defineProperty(HTMLElement.prototype, property, descriptor);
    }
  };
};
