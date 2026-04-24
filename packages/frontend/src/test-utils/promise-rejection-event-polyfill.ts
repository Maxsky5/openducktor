export function ensurePromiseRejectionEventPolyfill(): void {
  if (typeof globalThis.PromiseRejectionEvent !== "undefined") {
    return;
  }

  (globalThis as Record<string, unknown>).PromiseRejectionEvent =
    class PromiseRejectionEvent extends Event {
      readonly reason: unknown;
      readonly promise: Promise<unknown>;

      constructor(type: string, init: EventInit & { reason?: unknown; promise: Promise<unknown> }) {
        super(type, init);
        this.reason = init.reason;
        this.promise = init.promise;
      }
    };
}
