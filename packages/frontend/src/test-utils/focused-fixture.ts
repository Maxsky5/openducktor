export const createFocusedFixture = <Value extends object>(value: Partial<Value>): Value => {
  // SAFETY: focused tests exercise only the supplied members; Partial verifies each member type.
  return value as Value;
};

interface InvalidFixtureInput extends Record<never, never> {}

type InvalidFixtureConstructor = abstract new (...args: never[]) => object;

export const createInvalidFixture = <Value extends object>(
  value: InvalidFixtureInput | InvalidFixtureConstructor,
): Value => {
  // SAFETY: boundary tests use this helper only to pass malformed runtime data through a static type gate.
  return value as Value;
};

export const createTimerFixture = (): ReturnType<typeof setTimeout> => {
  const timer = setTimeout(() => {}, 60_000);
  clearTimeout(timer);
  return timer;
};

export const createFileListFixture = (files: readonly File[]): FileList =>
  Object.assign([...files], {
    item: (index: number) => files[index] ?? null,
  });

export const createDataTransferItemFixture = ({
  file = null,
  kind,
  type,
}: {
  file?: File | null;
  kind: DataTransferItem["kind"];
  type: string;
}): DataTransferItem => ({
  kind,
  type,
  getAsFile: () => file,
  getAsString: (callback) => callback?.(""),
  webkitGetAsEntry: () => null,
});

export const createDataTransferItemListFixture = (
  items: readonly DataTransferItem[],
): DataTransferItemList =>
  Object.assign([...items], {
    add: () => null,
    clear: () => {},
    remove: () => {},
  });
