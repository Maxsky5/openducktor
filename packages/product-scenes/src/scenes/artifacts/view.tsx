// Task artifacts: the session page of the sample task while its Builder works, with the top bar and
// its actions, the workflow rail, the Builder chat, and the right panel on the Artifacts tab. The
// Builder saves an HTML wireframe of the search dialog on the task. The file shows in the Artifacts
// tab under the workflow documents. The visitor opens it and expands its preview. The preview
// dialog is a template. Sources: task-artifacts.tsx, artifact-controls.tsx,
// task-artifact-preview-dialog.tsx, and task-artifact-html-preview.tsx in
// packages/frontend/src/components/features/task-artifacts, and
// agent-chat-artifact-tool-message.tsx in
// packages/frontend/src/components/features/agents/agent-chat. The markup holds the last frame:
// the file is open in the tab, and the dialog is closed. A narrow stage shows one column at a time:
// the chat, then the Artifacts tab from the save.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Stock } from "../../frame/Stock";
import { ArtifactCollection } from "../../replicas/studio/ArtifactCollection";
import { ArtifactFile } from "../../replicas/studio/ArtifactFile";
import { ArtifactPreviewDialog } from "../../replicas/studio/ArtifactPreviewDialog";
import { StudioWindow } from "../../replicas/studio/StudioWindow";
import { AgentText } from "../../replicas/transcript/AgentText";
import { ArtifactCard } from "../../replicas/transcript/ArtifactCard";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { Paragraph } from "../../replicas/ui/InlineCode";
import { Tooltip } from "../../replicas/ui/Tooltip";
import { signature } from "../../sample/sessions";
import {
  ARTIFACT_GROUPS,
  type ArtifactsTemplate,
  ASK,
  FRAME,
  INTRO,
  MOCKUP,
  MOCKUP_FILE,
  SAVE_DURATION,
  SAVED,
  SESSION,
  TIMES,
  WORKED,
} from "./sample";
import { SearchMockup } from "./SearchMockup";
import "./view.css";

/** The Artifacts tab, with the file open. */
function ArtifactsTab(): ReactElement {
  return (
    <>
      <ArtifactCollection groups={ARTIFACT_GROUPS} hidden />
      <ArtifactFile artifact={MOCKUP} fileName={MOCKUP_FILE}>
        <SearchMockup />
      </ArtifactFile>
    </>
  );
}

export function ArtifactsView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="artifacts"
      alt="The session page of the task Open search with a keyboard shortcut, with the workflow rail Spec, Planner, Builder, and QA. The Builder works, and the visitor asked it to save a wireframe of the search dialog on the task. The right panel shows the Artifacts tab, with the Specification and the Implementation Plan in the Workflow group. The Builder answers that it will draw the dialog as a wireframe in one HTML page, then saves it with a Set Artifact card: Set Artifact · Search dialog wireframe, with an Open button. In the Artifacts tab, a Files group shows under the workflow documents with Search dialog wireframe, HTML, 6.2 KiB, just now. The Builder ends its turn and asks what to change. The visitor selects the file in the list. The tab shows the rendered page, a light page in both themes: a grey wireframe of the search dialog with the Cmd+K hint, four recent notes, and the keys Move, Open, and Close, with a red number on each part and a note for each number. The visitor selects Expand, and the preview opens in a large dialog. Then the visitor closes the dialog."
      stock={
        <Stock name={"preview-dialog" satisfies ArtifactsTemplate}>
          <ArtifactPreviewDialog name={MOCKUP.name}>
            <SearchMockup />
          </ArtifactPreviewDialog>
        </Stock>
      }
    >
      <StudioWindow
        frame={FRAME}
        keys={props.keys}
        className="af-window"
        panels={{ document: <ArtifactsTab /> }}
        overlay={<Tooltip />}
      >
        <UserMessage time={TIMES.ask} row="ask">
          {ASK}
        </UserMessage>
        <AgentText row="intro">
          <Paragraph text={INTRO} />
        </AgentText>
        <ArtifactCard name={MOCKUP.name} duration={SAVE_DURATION} time={TIMES.save} row="save" />
        <AgentText signature={signature(SESSION)} worked={WORKED} row="saved">
          <Paragraph text={SAVED} />
        </AgentText>
      </StudioWindow>
    </SceneFrame>
  );
}
