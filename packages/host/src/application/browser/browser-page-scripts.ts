/**
 * Scripts that the host runs in an isolated world of each page. Page code cannot see an isolated
 * world, but the world shares the DOM. Each script reports through one binding of that world.
 */
export const BROWSER_HOST_WORLD = "__openducktor_host";
export const BROWSER_HOST_BINDING = "__openducktorHost";

/**
 * Reports the title and icon link and the anchor boxes of annotations. It installs once in the top
 * document of each page, so a frame never changes the tab title.
 */
export const BROWSER_HOST_WORLD_SCRIPT = `(() => {
  if (window !== window.top || globalThis.__odtHostInstalled) return;
  globalThis.__odtHostInstalled = true;
  const send = (message) => {
    try { globalThis.${BROWSER_HOST_BINDING}(JSON.stringify(message)); } catch (error) {}
  };

  let lastTitle = null;
  let lastIcon = null;
  const iconHref = () => {
    const link = document.querySelector('link[rel~="icon" i]');
    return link && link.href ? link.href : null;
  };
  const reportInfo = () => {
    const title = document.title;
    const icon = iconHref();
    if (title === lastTitle && icon === lastIcon) return;
    lastTitle = title;
    lastIcon = icon;
    send({ type: "page_info", title, icon, origin: location.origin });
  };
  const observeHead = () => {
    reportInfo();
    if (document.head) {
      new MutationObserver(reportInfo).observe(document.head, {
        subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ["href", "rel"],
      });
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeHead, { once: true });
  } else {
    observeHead();
  }

  let anchors = [];
  let anchorFrame = 0;
  const boxOf = (selectors) => {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const selector of selectors) {
      let element = null;
      try { element = document.querySelector(selector); } catch (error) { element = null; }
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      left = Math.min(left, rect.left); top = Math.min(top, rect.top);
      right = Math.max(right, rect.right); bottom = Math.max(bottom, rect.bottom);
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  const reportAnchors = () => {
    anchorFrame = 0;
    send({
      type: "anchor_boxes",
      boxes: anchors.map((anchor) => ({ annotationId: anchor.annotationId, box: boxOf(anchor.selectors) })),
    });
  };
  const scheduleAnchors = () => {
    if (anchors.length === 0 || anchorFrame !== 0) return;
    anchorFrame = requestAnimationFrame(reportAnchors);
  };
  addEventListener("scroll", scheduleAnchors, { capture: true, passive: true });
  addEventListener("resize", scheduleAnchors, { passive: true });
  new MutationObserver(scheduleAnchors).observe(document, { subtree: true, childList: true, attributes: true });
  globalThis.__odtSetAnchors = (next) => {
    anchors = next;
    reportAnchors();
  };
  globalThis.__odtRevealAnchor = (annotationId) => {
    const anchor = anchors.find((candidate) => candidate.annotationId === annotationId);
    let element = null;
    try { element = anchor ? document.querySelector(anchor.selectors[0]) : null; } catch (error) { element = null; }
    element?.scrollIntoView({ block: "center", inline: "nearest" });
  };

  globalThis.__odtSelectedText = () => {
    const active = document.activeElement;
    if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) &&
        active.selectionStart !== null && active.selectionStart !== active.selectionEnd) {
      return active.value.slice(active.selectionStart, active.selectionEnd);
    }
    const text = String(getSelection() || "");
    return text.length > 0 ? text : null;
  };
})();`;
