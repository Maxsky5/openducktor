import { hasRuntimeType } from "@openducktor/contracts";
export function ensurePromiseRejectionEventPolyfill(): void {
  if (!hasRuntimeType(globalThis.PromiseRejectionEvent, "undefined")) {
    return;
  }

  Object.assign(globalThis, {
    PromiseRejectionEvent: class PromiseRejectionEvent extends Event {
      readonly reason: unknown;
      readonly promise: Promise<unknown>;

      constructor(type: string, init: EventInit & { reason?: unknown; promise: Promise<unknown> }) {
        super(type, init);
        this.reason = init.reason;
        this.promise = init.promise;
      }
    },
  });
}
