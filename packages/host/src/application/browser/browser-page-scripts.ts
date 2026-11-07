/**
 * Scripts that the host runs in an isolated world of each page. Page code cannot see an isolated
 * world, but the world shares the DOM. Each script reports through one binding of that world.
 */
export const BROWSER_HOST_WORLD = "__openducktor_host";
export const BROWSER_HOST_BINDING = "__openducktorHost";

/**
 * Reports the title, the icon link, and the boxes of annotated elements. It draws the markers of
 * the annotations, the picker, and the agent marker in a closed shadow root over the page, because
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
  overlayHost.style.setProperty("z-index", "2147483647", "important");
  overlayHost.style.setProperty("overflow", "hidden", "important");
  if (document.documentElement) {
    document.documentElement.appendChild(overlayHost);
  } else {
    document.addEventListener("DOMContentLoaded", () => document.documentElement.appendChild(overlayHost), { once: true });
  }
  const overlay = overlayHost.attachShadow({ mode: "closed" });
  const layer = document.createElement("div");
  layer.style.setProperty("position", "absolute", "important");
  layer.style.setProperty("inset", "0", "important");
  layer.style.setProperty("pointer-events", "none", "important");
  layer.style.setProperty("overflow", "hidden", "important");
  overlay.appendChild(layer);

  const boxElement = () => {
    const element = document.createElement("div");
    element.style.setProperty("position", "absolute", "important");
    element.style.setProperty("pointer-events", "none", "important");
    element.style.setProperty("box-sizing", "border-box", "important");
    return element;
  };
  const setBox = (element, box) => {
    element.style.setProperty("left", box.x + "px", "important");
    element.style.setProperty("top", box.y + "px", "important");
    element.style.setProperty("width", box.width + "px", "important");
    element.style.setProperty("height", box.height + "px", "important");
  };

  /* Picker. */
  const pickerTarget = boxElement();
  pickerTarget.style.setProperty("border", "1px solid #0ea5e9", "important");
  pickerTarget.style.setProperty("background", "rgba(56, 189, 248, 0.25)", "important");
  pickerTarget.style.setProperty("border-radius", "2px", "important");
  pickerTarget.hidden = true;
  layer.appendChild(pickerTarget);
  const pickerLabel = document.createElement("span");
  pickerLabel.style.setProperty("position", "absolute", "important");
  pickerLabel.style.setProperty("left", "0", "important");
  pickerLabel.style.setProperty("max-width", "16rem", "important");
  pickerLabel.style.setProperty("overflow", "hidden", "important");
  pickerLabel.style.setProperty("text-overflow", "ellipsis", "important");
  pickerLabel.style.setProperty("white-space", "nowrap", "important");
  pickerLabel.style.setProperty("border-radius", "2px", "important");
  pickerLabel.style.setProperty("background", "#7dd3fc", "important");
  pickerLabel.style.setProperty("padding", "0 6px", "important");
  pickerLabel.style.setProperty("color", "#0a0a0a", "important");
  pickerLabel.style.setProperty("font", "500 11px/20px system-ui, sans-serif", "important");
  pickerTarget.appendChild(pickerLabel);
  const selectionLayer = document.createElement("div");
  selectionLayer.style.setProperty("position", "absolute", "important");
  selectionLayer.style.setProperty("inset", "0", "important");
  selectionLayer.style.setProperty("pointer-events", "none", "important");
  layer.appendChild(selectionLayer);

  let pickerActive = false;
  let hoverFrame = 0;
  let hoverPoint = null;
  const flushHover = () => {
    hoverFrame = 0;
    if (!pickerActive || hoverPoint === null) return;
    const point = hoverPoint;
    hoverPoint = null;
    send({ type: "picker_hover", x: point.x, y: point.y });
  };
  const onPointerMove = (event) => {
    if (!pickerActive) return;
    hoverPoint = { x: event.clientX, y: event.clientY };
    if (hoverFrame === 0) hoverFrame = requestAnimationFrame(flushHover);
  };
  const stopPageEvent = (event) => {
    if (!pickerActive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onPick = (event) => {
    if (!pickerActive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    send({ type: "picker_pick", x: event.clientX, y: event.clientY, shiftKey: event.shiftKey });
  };
  const onPickerKey = (event) => {
    if (!pickerActive || event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    send({ type: "picker_cancel" });
  };
  const pickerListeners = [
    ["pointermove", onPointerMove, true],
    ["pointerdown", stopPageEvent, true],
    ["mousedown", stopPageEvent, true],
    ["click", onPick, true],
    ["dblclick", stopPageEvent, true],
    ["contextmenu", stopPageEvent, true],
    ["keydown", onPickerKey, true],
  ];
  const syncPickerListeners = () => {
    for (const [name, listener, capture] of pickerListeners) {
      if (pickerActive) addEventListener(name, listener, capture);
      else removeEventListener(name, listener, capture);
    }
  };

  globalThis.__odtPickerActive = (active) => {
    if (pickerActive === active) return;
    pickerActive = active;
    syncPickerListeners();
    if (!active) {
      hoverPoint = null;
      pickerTarget.hidden = true;
      selectionLayer.replaceChildren();
    }
  };
  globalThis.__odtPickerTarget = (target) => {
    if (!target) {
      pickerTarget.hidden = true;
      return;
    }
    pickerTarget.hidden = false;
    setBox(pickerTarget, target.box);
    pickerLabel.textContent = target.label;
    pickerLabel.style.setProperty("top", target.box.y >= 21 ? "-21px" : "0", "important");
  };
  globalThis.__odtPickerSelection = (boxes) => {
    const elements = boxes.map((box) => {
      const element = boxElement();
      element.style.setProperty("border-radius", "2px", "important");
      element.style.setProperty("background", "rgba(56, 189, 248, 0.15)", "important");
      element.style.setProperty("outline", "2px solid #0284c7", "important");
      setBox(element, box);
      return element;
    });
    selectionLayer.replaceChildren(...elements);
  };

  /* Annotation markers. */
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

  /* A short pulse where an agent clicks, hovers, or types. */
  globalThis.__odtAgentMarker = (action, x, y) => {
    const marker = document.createElement("span");
    marker.setAttribute("aria-hidden", "true");
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
