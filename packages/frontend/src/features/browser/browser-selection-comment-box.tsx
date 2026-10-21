import type { ReactElement } from "react";
import {
  type BrowserAnnotationChanges,
  BrowserAnnotationCommentBox,
  useBrowserAnnotationStore,
} from "@/features/browser-annotations";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  BROWSER_COMMENT_BOX_WIDTH,
  commentBoxPosition,
  selectionBox,
} from "./browser-comment-box-position";
import type { BrowserPickedElement } from "./use-browser-picker";

/**
 * The comment box of a picker selection. Save captures the selected elements on the host and
 * adds a pending annotation for the owner of the tab.
 */
export function BrowserSelectionCommentBox({
  tabId,
  ownerKey,
  selection,
  bounds,
  onDone,
}: {
  tabId: string;
  ownerKey: string;
  selection: readonly BrowserPickedElement[];
  bounds: { width: number; height: number };
  onDone: () => void;
}): ReactElement {
  const hostClient = useHostClient();
  const annotationStore = useBrowserAnnotationStore();
  const position = commentBoxPosition(
    selectionBox(selection.map((element) => element.box)),
    bounds,
  );
  const save = async ({ comment, includeScreenshot }: BrowserAnnotationChanges): Promise<void> => {
    const capture = await hostClient.browserAnnotationCapture({
      tabId,
      nodeRefs: selection.map((element) => element.nodeRef),
    });
    annotationStore.getState().addAnnotation(ownerKey, { capture, comment, includeScreenshot });
    onDone();
  };
  return (
    <div
      className="pointer-events-auto absolute z-30"
      style={{ left: position.left, top: position.top, width: BROWSER_COMMENT_BOX_WIDTH }}
    >
      <BrowserAnnotationCommentBox
        mode="create"
        targetLabel={
          selection.length === 1
            ? (selection[0]?.label ?? "element")
            : `${selection.length} elements`
        }
        onSave={save}
        onCancel={onDone}
      />
    </div>
  );
}
