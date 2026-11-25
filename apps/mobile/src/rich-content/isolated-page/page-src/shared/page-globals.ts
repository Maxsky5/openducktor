/**
 * Supplies the newer built-ins that page code calls. Pages run in the system WebView, and on iOS
 * that is the WebKit of the OS. The app supports iOS 16.4, whose WebKit has no
 * `Promise.withResolvers`, which the terminal output sequencer calls. It came with Safari 17.4.
 * The app startup check covers Hermes only, not the WebView.
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

export const installPageGlobals = (): void => {
  if (!Object.hasOwn(Promise, "withResolvers")) {
    Object.defineProperty(Promise, "withResolvers", {
      value: promiseWithResolvers,
      configurable: true,
      writable: true,
    });
  }
};

installPageGlobals();
