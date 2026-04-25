export const replaceNavigatorClipboard = (
  writeText: (value: string) => Promise<void>,
): (() => void) => {
  const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText,
    },
  });

  return () => {
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
      return;
    }

    Reflect.deleteProperty(navigator, "clipboard");
  };
};
