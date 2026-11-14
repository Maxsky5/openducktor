import { useState } from "react";

/**
 * The value that a component had when it mounted. Motion that only a change after the mount
 * starts reads it, so a row that mounts with its content shows at once.
 */
export const useValueAtMount = <Value>(value: Value): Value => {
  const [valueAtMount] = useState(value);
  return valueAtMount;
};
