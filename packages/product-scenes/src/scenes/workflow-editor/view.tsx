// The workflow editor of a custom workflow, at the width of three panels: the element list, the
// canvas with its readiness line, and the details of the selection. Sources: workflow-editor.tsx,
// editor-header.tsx, version-switcher.tsx, and the canvas, panels, inspector, and dialogs folders
// of packages/frontend/src/features/workflows/editor, with workflow-status-text.ts. The markup
// holds the last frame: version 2 is published, the editor shows it again in auto layout without
// a selection, and the toast of the publication shows. The pointer shows in the frame of the app
// tour too, so each dialog and the new line show their cause.
import type { CSSProperties, ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { AppWindow } from "../../replicas/shell/AppWindow";
import { Pointer } from "../../replicas/shell/Pointer";
import { SuccessToast } from "../../replicas/shell/Toast";
import { ToastStack } from "../../replicas/shell/ToastStack";
import { EventInspector } from "../../replicas/workflows/EventInspector";
import { StateInspector } from "../../replicas/workflows/StateInspector";
import { publishedToast } from "../../replicas/workflows/text";
import { AddStateDialog, PublishDialog } from "../../replicas/workflows/WorkflowDialogs";
import { fitAround, fitViewport } from "../../replicas/workflows/viewport";
import { WorkflowEditor } from "../../replicas/workflows/WorkflowEditor";
import { studioNav } from "../../sample/studio-nav";
import {
  BUTTONS,
  CANVAS_SIZE,
  FRAMES,
  ISSUE_TYPES,
  LINES,
  MOVABLE_TASKS,
  NEW_EVENT,
  NEW_LINE_ENDS,
  NEW_STATE,
  OUTLINE_TRANSITIONS,
  READINESS,
  REPOSITORY,
  STATE_LIST,
  STATE_PROBLEM,
  TOAST_ROOM,
  VERSION,
  WORKFLOW,
} from "./sample";
import "./view.css";

const NEXT = VERSION + 1;

type Layout = "wide" | "phone" | "framed";
type FitVar = `--${Layout}-${"start" | "fit"}-${"x" | "y" | "zoom"}`;

/**
 * The fits of the canvas in each layout of the stage, which view.css gives to the canvas: the fit
 * of the first frame as the editor opens the workflow, and the fit of the last frame, whose toast
 * covers the right of the window, or the bottom of the canvas on a phone stage. The build of the
 * scene then measures no layout.
 */
function layoutFits(): CSSProperties & Record<FitVar, number> {
  const first = FRAMES.published.content;
  const last = FRAMES.republished.content;
  const start = {
    wide: fitViewport(first, CANVAS_SIZE.wide),
    phone: fitViewport(first, CANVAS_SIZE.phone),
    framed: fitViewport(first, CANVAS_SIZE.framed),
  };
  const end = {
    wide: fitAround(last, CANVAS_SIZE.wide, TOAST_ROOM.wide),
    phone: fitAround(last, CANVAS_SIZE.phone, TOAST_ROOM.phone),
    framed: fitAround(last, CANVAS_SIZE.framed, TOAST_ROOM.wide),
  };
  return {
    "--wide-start-x": start.wide.x,
    "--wide-start-y": start.wide.y,
    "--wide-start-zoom": start.wide.zoom,
    "--phone-start-x": start.phone.x,
    "--phone-start-y": start.phone.y,
    "--phone-start-zoom": start.phone.zoom,
    "--framed-start-x": start.framed.x,
    "--framed-start-y": start.framed.y,
    "--framed-start-zoom": start.framed.zoom,
    "--wide-fit-x": end.wide.x,
    "--wide-fit-y": end.wide.y,
    "--wide-fit-zoom": end.wide.zoom,
    "--phone-fit-x": end.phone.x,
    "--phone-fit-y": end.phone.y,
    "--phone-fit-zoom": end.phone.zoom,
    "--framed-fit-x": end.framed.x,
    "--framed-fit-y": end.framed.y,
    "--framed-fit-zoom": end.framed.zoom,
  };
}

export function WorkflowEditorView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="workflow-editor"
      alt={`The workflow editor of the custom workflow ${WORKFLOW}, version ${VERSION}, published. The element list shows the states Backlog, Fixing, and Done, and the canvas shows them as boxes, linked by the transitions Start fixing and Mark fixed. The visitor clicks Add a state, types ${NEW_STATE.label} in the Add a state dialog, and clicks Create. The box ${NEW_STATE.label} takes the place of Done, and Done moves one row down. The details of the new state open with a warning: tasks cannot reach ${NEW_STATE.label}. The draft saves, and the status shows Version ${VERSION}, Unpublished changes. The visitor drags a line from the dot under Fixing onto ${NEW_STATE.label}. The new transition Move to Test shows as a dotted line, and its details warn that nothing triggers it. The visitor clicks Add a button. The line turns solid with a button icon, and the line under the canvas says Ready to publish. The visitor clicks Publish and confirms in the Publish the draft dialog, which offers to move a task from version ${VERSION}. The status shows Version ${NEXT}, Published, a toast says Published version ${NEXT}, and the line under the canvas says Published.`}
    >
      <AppWindow
        chrome={
          props.framed
            ? { sidebar: "none" }
            : { sidebar: "collapsed", nav: { scope: "current", entries: studioNav() } }
        }
        keys={props.keys}
        className="wfes-window"
        style={layoutFits()}
        data-keep-pointer=""
        overlay={
          <>
            <AddStateDialog />
            <PublishDialog version={NEXT} repository={REPOSITORY} tasks={MOVABLE_TASKS} />
            <ToastStack>
              <SuccessToast {...publishedToast(NEXT)} />
            </ToastStack>
            <Pointer />
          </>
        }
      >
        <WorkflowEditor
          header={{ workflow: WORKFLOW, version: NEXT, draft: false, canUndo: false }}
          outline={{
            states: STATE_LIST,
            transitions: OUTLINE_TRANSITIONS,
            buttons: BUTTONS.after,
            issueTypes: ISSUE_TYPES,
          }}
          canvas={{
            states: STATE_LIST,
            lines: LINES,
            frame: FRAMES.republished,
            grips: NEW_LINE_ENDS,
          }}
          problems={READINESS.published}
          details={
            <>
              <StateInspector state={NEW_STATE} problem={STATE_PROBLEM} />
              <EventInspector event={NEW_EVENT} states={STATE_LIST} triggered />
            </>
          }
          detailsOpen={false}
        />
      </AppWindow>
    </SceneFrame>
  );
}
