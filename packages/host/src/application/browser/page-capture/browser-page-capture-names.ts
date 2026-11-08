/** The component type of a React fiber, as React keeps it on the page. */
export type PageFiberType = {
  displayName?: string;
  name?: string;
  render?: PageFiberType;
  type?: PageFiberType;
};

/** A React fiber. Its `type` is a component only for the component work tags. */
export type PageFiber = {
  tag: number;
  type: PageFiberType | null;
  return: PageFiber | null;
};

/** React work tags of components: function, class, forwardRef, memo, simple memo. */
const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);

/**
 * The name of the component of a fiber, or null for a fiber that is not a component or a
 * component without a name. An anonymous function has the name `""`, which names nothing.
 */
export const componentName = (fiber: PageFiber): string | null => {
  const type = fiber.type;
  if (!COMPONENT_TAGS.has(fiber.tag) || type === null) {
    return null;
  }
  const inner = type.render ?? type.type ?? type;
  const names = [type.displayName, inner.displayName, inner.name, type.name];
  return names.find((name) => name !== undefined && name.trim().length > 0) ?? null;
};
