/** Freezes a data tree in place and returns it. */
export const deepFreeze = <T>(value: T): T => {
  if (value instanceof Object && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};
