export function observeDialogResize(element: HTMLDivElement): () => void {
  let previousSize: { width: number; height: number } | null = null;
  let animation: Animation | null = null;
  const hiddenScrollbarAreas = new Set<HTMLElement>();
  const clearHiddenScrollbars = () => {
    for (const area of hiddenScrollbarAreas) area.removeAttribute("data-dialog-scrollbar-hidden");
    hiddenScrollbarAreas.clear();
  };
  const hideTransientScrollbars = () => {
    clearHiddenScrollbars();
    const scrollAreas = [
      element,
      ...element.querySelectorAll<HTMLElement>(
        ".overflow-auto, .overflow-y-auto, .overflow-scroll, .overflow-y-scroll",
      ),
    ];
    for (const area of scrollAreas) {
      if (area.scrollHeight > area.clientHeight) continue;
      const overflowY = getComputedStyle(area).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        area.setAttribute("data-dialog-scrollbar-hidden", "");
        hiddenScrollbarAreas.add(area);
      }
    }
  };
  const retargetAnimation = () => {
    if (!animation) return;

    // Read the visible size before removing the old animation, then measure the new content.
    const from = element.getBoundingClientRect();
    const activeAnimation = animation;
    animation = null;
    mutationObserver.disconnect();
    activeAnimation.cancel();
    const size = element.getBoundingClientRect();
    previousSize = size;
    if (Math.abs(size.width - from.width) >= 1 || Math.abs(size.height - from.height) >= 1) {
      animateResize(from, size);
    } else {
      element.removeAttribute("data-dialog-resizing");
      clearHiddenScrollbars();
      observer.observe(element, { box: "border-box" });
    }
  };
  const mutationObserver = new MutationObserver(retargetAnimation);
  element.addEventListener("load", retargetAnimation, true);
  window.addEventListener("resize", retargetAnimation);
  document.fonts?.addEventListener("loadingdone", retargetAnimation);

  function animateResize(
    from: { width: number; height: number },
    size: { width: number; height: number },
  ) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      element.removeAttribute("data-dialog-resizing");
      clearHiddenScrollbars();
      observer.observe(element, { box: "border-box" });
      return;
    }

    const styles = getComputedStyle(element);
    observer.unobserve(element);
    // Check the target layout before the animation constrains the dialog's size.
    hideTransientScrollbars();
    // Width and height animation is intentional: the dialog follows its changing content.
    const currentAnimation = element.animate(
      [
        {
          width: `${from.width}px`,
          height: `${from.height}px`,
          maxWidth: "none",
          maxHeight: "none",
        },
        {
          width: `${size.width}px`,
          height: `${size.height}px`,
          maxWidth: "none",
          maxHeight: "none",
        },
      ],
      {
        duration: Number.parseFloat(styles.getPropertyValue("--resize-dur")),
        easing: styles.getPropertyValue("--resize-ease").trim(),
      },
    );
    animation = currentAnimation;
    element.setAttribute("data-dialog-resizing", "");
    mutationObserver.observe(element, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const clearAnimation = () => {
      if (animation !== currentAnimation) return;
      animation = null;
      mutationObserver.disconnect();
      element.removeAttribute("data-dialog-resizing");
      clearHiddenScrollbars();
      observer.observe(element, { box: "border-box" });
    };
    void currentAnimation.finished.then(clearAnimation, clearAnimation);
  }

  const observer = new ResizeObserver(([entry]) => {
    if (!entry) return;
    const borderBox = entry.borderBoxSize?.[0];
    const size = borderBox
      ? { width: borderBox.inlineSize, height: borderBox.blockSize }
      : entry.target.getBoundingClientRect();

    if (previousSize === null) {
      previousSize = size;
      return;
    }
    if (animation) return;
    if (
      Math.abs(size.width - previousSize.width) < 1 &&
      Math.abs(size.height - previousSize.height) < 1
    ) {
      return;
    }

    const from = previousSize;
    previousSize = size;
    animateResize(from, size);
  });
  observer.observe(element, { box: "border-box" });

  return () => {
    observer.disconnect();
    mutationObserver.disconnect();
    element.removeEventListener("load", retargetAnimation, true);
    window.removeEventListener("resize", retargetAnimation);
    document.fonts?.removeEventListener("loadingdone", retargetAnimation);
    element.removeAttribute("data-dialog-resizing");
    clearHiddenScrollbars();
    const activeAnimation = animation;
    animation = null;
    activeAnimation?.cancel();
  };
}
