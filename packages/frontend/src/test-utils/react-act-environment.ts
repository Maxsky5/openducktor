export const enableReactActEnvironment = (): void => {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  });
};

export const installReactActEnvironment = (): (() => void) => {
  const previousDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  enableReactActEnvironment();

  return () => {
    if (previousDescriptor) {
      Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", previousDescriptor);
      return;
    }

    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  };
};
