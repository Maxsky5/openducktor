// An IntersectionObserver for the tests of the players. Production code does not import it.

/**
 * An IntersectionObserver of happy-dom, which has no layout, that keeps the elements that it
 * watches. A test reports with `report` that an element enters or leaves the zone of its
 * observers. Create it after the browser globals.
 */
export function testObserver() {
  return class TestObserver extends IntersectionObserver {
    /** The observers that watch one element or more. */
    static readonly live = new Set<TestObserver>();
    readonly targets = new Set<Element>();
    constructor(
      readonly callback: IntersectionObserverCallback,
      readonly options?: IntersectionObserverInit,
    ) {
      super(callback, options);
    }
    override observe(target: Element): void {
      this.targets.add(target);
      TestObserver.live.add(this);
    }
    override disconnect(): void {
      this.targets.clear();
      TestObserver.live.delete(this);
    }
    /** Reports to the observers that watch `target` that it enters or leaves their zone. */
    static report(target: Element, isIntersecting: boolean): void {
      for (const observer of TestObserver.live) {
        if (!observer.targets.has(target)) continue;
        // SAFETY: the players read only isIntersecting from an entry.
        observer.callback([{ isIntersecting } as IntersectionObserverEntry], observer);
      }
    }
  };
}
