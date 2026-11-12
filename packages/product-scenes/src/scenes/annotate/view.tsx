// A browser tab with the Fieldnotes app in the right panel of a task session. The visitor turns
// on Annotate, selects two elements of the page, types what to change for each, and saves. The
// count of pending annotations and the count on Send go up. The visitor sends a short message,
// which carries the annotations, and the Builder fixes the page. The dev server updates it.
// Sources: features/browser and features/browser-annotations in packages/frontend/src, and
// agent-chat-composer-pending-items.tsx. The markup holds the last frame. A phone stage shows one
// panel at a time, so the visitor goes back to the chat to send.
import type { CSSProperties, ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { AnnotatedMessage } from "../../replicas/browser/AnnotatedMessage";
import { BrowserSession } from "../../replicas/browser/BrowserSession";
import { BuilderReply } from "../../replicas/browser/BuilderReply";
import { EMPTY_SUBTITLE } from "../../replicas/browser/FieldnotesPage";
import { Composer, ComposerDraft } from "../../replicas/studio/Composer";
import { AgentText } from "../../replicas/transcript/AgentText";
import { PatchCard } from "../../replicas/transcript/PatchCard";
import { Thread } from "../../replicas/transcript/Thread";
import { PAGE_TITLE } from "../../sample/browser";
import { signature } from "../../sample/sessions";
import { BUILDER_SESSION } from "../../sample/studio";
import {
  ANNOTATION_MESSAGE,
  ANNOTATIONS,
  EMPTY_STATE_FILE,
  FIX_WORKED,
  MESSAGE_TIME,
} from "./sample";
import "./view.css";

/** The scale of a screenshot, so the image chip covers its preview with it. */
const shotScale = (scale: number): CSSProperties & { "--shot-scale": number } => ({
  "--shot-scale": scale,
});

/** The screenshot of each annotation: the captured element before the fix. */
const SHOTS = [
  <div className="fn av-shot" data-version="before" style={shotScale(1.85)} key="create">
    <span className="fn-create">
      <span>Create a note</span>
    </span>
  </div>,
  <div className="fn av-shot" data-version="before" style={shotScale(1.65)} key="subtitle">
    <span className="fn-empty-subtitle">{EMPTY_SUBTITLE}</span>
  </div>,
];

const NOTES = ANNOTATIONS.map((annotation) => annotation.note);

export function AnnotateView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="annotate"
      alt={`The session page of a task, with the ${PAGE_TITLE} app of the dev server in a browser tab of the right panel. The page shows an empty notebook. The developer selects Annotate in the toolbar of the tab. The developer selects the Create a note button, types "${NOTES[0]}", and selects Save. A numbered marker shows on the button, and Pending annotations shows 1. The developer selects the text under the title, types "${NOTES[1]}", and saves. The count goes to 2, and so does the count on the Send button. The developer types "${ANNOTATION_MESSAGE}" in the composer and sends it. The message shows the two annotations and their screenshots. The Builder changes the empty notebook, and the page in the tab shows a violet Create a note button with a plus icon and an Import notes link.`}
    >
      <BrowserSession tabLabel={PAGE_TITLE} notebook="travel" version="after" annotate>
        <Thread>
          <BuilderReply />
          <AnnotatedMessage
            text={ANNOTATION_MESSAGE}
            comments={NOTES}
            shots={SHOTS}
            time={MESSAGE_TIME}
            row="message"
          />
          <PatchCard path={EMPTY_STATE_FILE} kind="M" add={9} del={3} row="patch" />
          <AgentText signature={signature(BUILDER_SESSION)} worked={FIX_WORKED} row="answer">
            <p>
              Create a note is now the main violet button, with a plus icon.{" "}
              <span data-annotation="2">An Import notes link follows it.</span>
            </p>
          </AgentText>
        </Thread>
        <Composer session={BUILDER_SESSION} sendBadge={{ kind: "annotations", count: 0 }}>
          <ComposerDraft />
        </Composer>
      </BrowserSession>
    </SceneFrame>
  );
}
