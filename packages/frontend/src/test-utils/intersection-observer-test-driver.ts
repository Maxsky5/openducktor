export const createIntersectionObserverTestDriver = () => {
  let restoreObserver: (() => void) | undefined;
  const observers: TestIntersectionObserver[] = [];
  let initiallyVisible = true;

  class TestIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    readonly scrollMargin = "0px";
    readonly thresholds = [0];
    private target: Element | null = null;

    constructor(
      private readonly callback: IntersectionObserverCallback,
      options: IntersectionObserverInit = {},
    ) {
      this.root = options.root ?? null;
      this.rootMargin = options.rootMargin ?? "0px";
      observers.push(this);
    }

    observe(target: Element): void {
      this.target = target;
      this.notify(initiallyVisible);
    }

    // Keep the target so tests can deliver a callback queued before disconnect.
    notify(isIntersecting: boolean): void {
      if (!this.target) return;
      const rect = this.target.getBoundingClientRect();
      this.callback(
        [
          {
            isIntersecting,
            target: this.target,
            time: 0,
            intersectionRatio: isIntersecting ? 1 : 0,
            boundingClientRect: rect,
            intersectionRect: rect,
            rootBounds: null,
          },
        ],
        this,
      );
    }

    disconnect(): void {}
    unobserve(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  return {
    observers,
    setInitiallyVisible(visible: boolean): void {
      initiallyVisible = visible;
    },
    install(): void {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver");
      restoreObserver = () => {
        if (descriptor) Object.defineProperty(globalThis, "IntersectionObserver", descriptor);
        else Reflect.deleteProperty(globalThis, "IntersectionObserver");
      };
      observers.length = 0;
      initiallyVisible = true;
      globalThis.IntersectionObserver = TestIntersectionObserver;
    },
    restore(): void {
      restoreObserver?.();
      restoreObserver = undefined;
      observers.length = 0;
    },
  };
};
