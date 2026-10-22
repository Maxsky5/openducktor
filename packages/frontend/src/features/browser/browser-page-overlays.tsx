import type { BrowserTabSummary } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { createPortal } from "react-dom";
import type { BrowserAnnotation } from "@/features/browser-annotations";
import type { BrowserChannel } from "./browser-channel";
import { BrowserSelectionCommentBox } from "./browser-selection-comment-box";
import { BrowserTabPromptOverlays } from "./browser-tab-prompts";
import { BrowserAgentMarker } from "./components/browser-agent-marker";
import { BrowserAnnotationMarkers } from "./components/browser-annotation-markers";
import { BrowserPickerOverlay } from "./components/browser-picker-overlay";
import { useBrowserAgentMarker } from "./use-browser-agent-marker";
import type { BrowserAnchors } from "./use-browser-anchors";
import type { BrowserPicker } from "./use-browser-picker";

/**
 * Annotation markers, the agent marker, the picker, the selection comment box, and the prompt
 * overlays of a tab. A portal draws them in the overlay element above the page surface.
 */
export function PageOverlays({
  tab,
  picker,
  ownerKey,
  annotations,
  anchors,
  overlayHost,
  channel,
}: {
  channel: BrowserChannel;
  tab: BrowserTabSummary;
  picker: BrowserPicker;
  ownerKey: string | null;
  annotations: readonly BrowserAnnotation[];
  anchors: BrowserAnchors;
  overlayHost: HTMLElement;
}): ReactElement {
  const agentMarker = useBrowserAgentMarker(channel, tab.tabId);
  const markers = annotations.map((annotation) => ({
    annotationId: annotation.id,
    number: annotation.number,
    box: anchors.boxOf(annotation.id),
  }));
  return createPortal(
    <>
      <BrowserAnnotationMarkers markers={markers} onSelect={anchors.reveal} />
      <BrowserAgentMarker marker={agentMarker} />
      {picker.state.active ? (
        <BrowserPickerOverlay
          target={picker.state.target}
          selected={picker.state.selection.map((element) => element.box)}
          onPointerMove={picker.hover}
          onPick={picker.pick}
          onCancel={picker.stop}
        />
      ) : null}
      {picker.state.selection.length > 0 && ownerKey !== null ? (
        <BrowserSelectionCommentBox
          tabId={tab.tabId}
          ownerKey={ownerKey}
          selection={picker.state.selection}
          bounds={{ width: overlayHost.clientWidth, height: overlayHost.clientHeight }}
          onDone={picker.clearSelection}
        />
      ) : null}
      <BrowserTabPromptOverlays tab={tab} />
    </>,
    overlayHost,
  );
}
