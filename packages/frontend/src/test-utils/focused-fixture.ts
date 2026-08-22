export const createFocusedFixture = <Value extends object>(value: Partial<Value>): Value => {
  const guardedValue = new Proxy(value, {
    get(target, property) {
      if (!(property in target)) {
        throw new Error(`Focused test fixture does not implement '${String(property)}'.`);
      }
      // SAFETY: The property-existence check proves this key is present on the partial fixture.
      return target[property as keyof Value];
    },
  });
  // SAFETY: The proxy rejects every read of an omitted member, while Partial checks each supplied member.
  return guardedValue as Value;
};

export const createInvalidFixture = <Value extends object, Source extends object = object>(
  value: Source,
): Value => {
  // SAFETY: boundary tests use this helper only to pass malformed object payloads through a static contract.
  return value as Source & Value;
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
