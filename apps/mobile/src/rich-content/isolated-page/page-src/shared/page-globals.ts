/**
 * Supplies the newer built-ins that page code calls. Pages run in the system WebView, and on iOS
 * that is the WebKit of the OS. The app supports iOS 16.4, whose WebKit has no
 * `Promise.withResolvers` (the terminal output sequencer) and no `Object.groupBy` (the Mermaid
 * parsers). Both came with Safari 17.4. The app startup check covers Hermes only, not the WebView.
 */

type PromiseResolvers<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value | PromiseLike<Value>) => void;
  reject: (cause?: unknown) => void;
};

export function promiseWithResolvers<Value>(): PromiseResolvers<Value> {
  let resolve!: PromiseResolvers<Value>["resolve"];
  let reject!: PromiseResolvers<Value>["reject"];
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** `Object.groupBy`: a null-prototype object with one array of items for each key. */
export function objectGroupBy<Item>(
  items: Iterable<Item>,
  keyOf: (item: Item, index: number) => PropertyKey,
): Record<PropertyKey, Item[]> {
  const groups: Record<PropertyKey, Item[]> = Object.create(null);
  let index = 0;
  for (const item of items) {
    const key = keyOf(item, index);
    index += 1;
    const group = groups[key];
    if (group) group.push(item);
    else groups[key] = [item];
  }
  return groups;
}

export const installPageGlobals = (): void => {
  if (!Object.hasOwn(Promise, "withResolvers")) {
    Object.defineProperty(Promise, "withResolvers", {
      value: promiseWithResolvers,
      configurable: true,
      writable: true,
    });
  }
  if (!Object.hasOwn(Object, "groupBy")) {
    Object.defineProperty(Object, "groupBy", {
      value: objectGroupBy,
      configurable: true,
      writable: true,
    });
  }
};

installPageGlobals();
