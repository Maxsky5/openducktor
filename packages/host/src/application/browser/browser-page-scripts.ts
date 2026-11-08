/**
 * Scripts that the host runs in an isolated world of each page. Page code cannot see an isolated
 * world, but the world shares the DOM. Each script reports through one binding of that world.
 */
export const BROWSER_HOST_WORLD = "__openducktor_host";
export const BROWSER_HOST_BINDING = "__openducktorHost";

/**
 * Reports the title, the icon link, and the boxes of annotated elements. It draws the markers of
 * the annotations and the agent marker in a closed shadow root over the page, because
 * a native page view draws above every element of the OpenDucktor window.
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

  /* The overlay host. Inline important styles keep page CSS out of the page furniture. */
  const overlayHost = document.createElement("div");
  overlayHost.style.setProperty("all", "initial", "important");
  overlayHost.style.setProperty("position", "fixed", "important");
  overlayHost.style.setProperty("inset", "0", "important");
  overlayHost.style.setProperty("pointer-events", "none", "important");
  // The picker hit test also finds elements with \`pointer-events: none\`, but never hidden ones.
  // Only the markers inside show, so the picker never finds the overlay.
  overlayHost.style.setProperty("visibility", "hidden", "important");
  overlayHost.style.setProperty("z-index", "2147483647", "important");
  overlayHost.style.setProperty("overflow", "hidden", "important");
  // A top-layer element, such as a modal dialog or a popover of the page, paints above any
  // z-index. A manual popover puts the overlay in the same top layer, so draw above those too.
  overlayHost.setAttribute("popover", "manual");
  // A modal dialog of the page makes every node outside it inert, so the overlay lives in the
  // last open modal dialog. Otherwise the markers get no input.
  const overlayParent = () => {
    const modals = document.querySelectorAll("dialog:modal");
    return modals[modals.length - 1] ?? document.documentElement;
  };
  const raiseOverlay = () => {
    const parent = overlayParent();
    if (!parent) return;
    // A move hides the popover. The overlay shows again after the move.
    if (overlayHost.parentNode !== parent) parent.appendChild(overlayHost);
    try { overlayHost.hidePopover(); } catch (error) {}
    try { overlayHost.showPopover(); } catch (error) {}
  };
  if (document.documentElement) {
    raiseOverlay();
  } else {
    document.addEventListener("DOMContentLoaded", raiseOverlay, { once: true });
  }
  // A page that opens a dialog or a popover after the overlay takes the top layer gains the top
  // layer above the overlay. Raise the overlay again so the markers stay above. A
  // dialog that closes gives the overlay back to the document or to the modal dialog under it.
  addEventListener("toggle", (event) => {
    if (event.target !== overlayHost) raiseOverlay();
  }, true);
  const overlay = overlayHost.attachShadow({ mode: "closed" });
  const layer = document.createElement("div");
  layer.style.setProperty("position", "absolute", "important");
  layer.style.setProperty("inset", "0", "important");
  layer.style.setProperty("pointer-events", "none", "important");
  layer.style.setProperty("overflow", "hidden", "important");
  overlay.appendChild(layer);

  /* Annotation markers. */
  let pickerActive = false;
  // The markers hide while the picker is on, so a pick never finds a marker.
  const markerVisibility = () => (pickerActive ? "hidden" : "visible");
  globalThis.__odtPickerActive = (active) => {
    pickerActive = active;
    for (const marker of markers.values()) {
      marker.style.setProperty("visibility", markerVisibility(), "important");
    }
  };
  let anchors = [];
  let anchorFrame = 0;
  let lastAnchorReport = "";
  const markers = new Map();
  const markerOf = (annotationId, number) => {
    let marker = markers.get(annotationId);
    if (marker && marker.textContent === String(number)) return marker;
    marker?.remove();
    marker = document.createElement("button");
    marker.type = "button";
    marker.textContent = String(number);
    marker.setAttribute("aria-label", "Annotation " + number);
    marker.style.setProperty("position", "absolute", "important");
    marker.style.setProperty("visibility", markerVisibility(), "important");
    marker.style.setProperty("pointer-events", "auto", "important");
    marker.style.setProperty("cursor", "pointer", "important");
    marker.style.setProperty("box-sizing", "border-box", "important");
    marker.style.setProperty("width", "20px", "important");
    marker.style.setProperty("height", "20px", "important");
    marker.style.setProperty("border", "0", "important");
    marker.style.setProperty("border-radius", "9999px", "important");
    marker.style.setProperty("background", "#7dd3fc", "important");
    marker.style.setProperty("box-shadow", "0 1px 3px rgba(0, 0, 0, 0.4)", "important");
    marker.style.setProperty("color", "#0a0a0a", "important");
    marker.style.setProperty("font", "600 11px/20px system-ui, sans-serif", "important");
    marker.style.setProperty("text-align", "center", "important");
    marker.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      globalThis.__odtRevealAnchor(annotationId);
    });
    markers.set(annotationId, marker);
    layer.appendChild(marker);
    return marker;
  };
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
    const boxes = anchors.map((anchor) => ({
      annotationId: anchor.annotationId,
      box: boxOf(anchor.selectors),
    }));
    const shown = new Set();
    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      const box = boxes[index].box;
      if (!box) continue;
      shown.add(anchor.annotationId);
      const marker = markerOf(anchor.annotationId, anchor.number);
      const left = Math.max(0, box.x - 10) + "px";
      const top = Math.max(0, box.y - 10) + "px";
      if (marker.style.left !== left) marker.style.setProperty("left", left, "important");
      if (marker.style.top !== top) marker.style.setProperty("top", top, "important");
    }
    for (const [annotationId, marker] of markers) {
      if (shown.has(annotationId)) continue;
      marker.remove();
      markers.delete(annotationId);
    }
    const report = JSON.stringify(boxes);
    if (report === lastAnchorReport) return;
    lastAnchorReport = report;
    send({ type: "anchor_boxes", boxes });
  };
  const scheduleAnchors = () => {
    if (anchors.length === 0 || anchorFrame !== 0) return;
    anchorFrame = requestAnimationFrame(reportAnchors);
  };
  addEventListener("scroll", scheduleAnchors, { capture: true, passive: true });
  addEventListener("resize", scheduleAnchors, { passive: true });
  new MutationObserver(() => {
    // A page that removes its open modal dialog removes the overlay with it.
    if (!overlayHost.isConnected) raiseOverlay();
    scheduleAnchors();
  }).observe(document, { subtree: true, childList: true, attributes: true });
  globalThis.__odtSetAnchors = (next) => {
    anchors = next;
    raiseOverlay();
    // Report the boxes of a new anchor set even when they match the last report, so a client that
    // just asked for anchors receives them.
    lastAnchorReport = "";
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

  /* A short pulse where an agent clicks, hovers, or types. */
  globalThis.__odtAgentMarker = (action, x, y) => {
    raiseOverlay();
    const marker = document.createElement("span");
    marker.setAttribute("aria-hidden", "true");
    marker.style.setProperty("visibility", "visible", "important");
    marker.style.setProperty("position", "absolute", "important");
    marker.style.setProperty("left", x + "px", "important");
    marker.style.setProperty("top", y + "px", "important");
    marker.style.setProperty("width", "28px", "important");
    marker.style.setProperty("height", "28px", "important");
    marker.style.setProperty("border", "2px solid #0ea5e9", "important");
    marker.style.setProperty("border-radius", "9999px", "important");
    marker.style.setProperty("pointer-events", "none", "important");
    marker.style.setProperty("transform", "translate(-50%, -50%)", "important");
    marker.style.setProperty(
      "background",
      action === "click" ? "rgba(56, 189, 248, 0.4)" : action === "type" ? "rgba(56, 189, 248, 0.25)" : "transparent",
      "important",
    );
    layer.appendChild(marker);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frames = reduced
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { opacity: 1, scale: 0.5 },
          { opacity: 1, scale: 1.5, offset: 0.35 },
          { opacity: 0, scale: 1.5 },
        ];
    const animation = marker.animate(frames, { duration: reduced ? 1000 : 700, easing: "ease-out" });
    animation.onfinish = () => marker.remove();
  };
})();`;
