// An MCP client creates a task, and the Kanban board of the desktop app shows it. The client is a
// neutral log, not a real product. The board is the replica of the Kanban page.
import { ArrowLeft, ArrowRight, FileBraces, LoaderCircle, Plug } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Board } from "../../replicas/board/Board";
import { BoardHead } from "../../replicas/board/BoardHead";
import type { BoardData } from "../../replicas/board/model";
import { Replica } from "../../replicas/Replica";
import { AppWindow } from "../../replicas/shell/AppWindow";
import {
  ARGUMENTS,
  jsonTokens,
  type JsonToken,
  NEW_TASK,
  PROMPT,
  RESULT,
  SERVER_ENTRY,
} from "./sample";
import "./view.css";

const ENTRY = jsonTokens(SERVER_ENTRY);
const CALL = jsonTokens(ARGUMENTS);
// The log cuts the task summary after its first fields.
const SUMMARY = jsonTokens(RESULT);
const RESULT_TOKENS: JsonToken[] = [
  ...SUMMARY.slice(0, -2),
  { kind: "punct", text: ", …" },
  ...SUMMARY.slice(-2),
];
const ID_TEXT = JSON.stringify(RESULT.task.id);
// The board of the desktop app, cropped to its first two lanes. The new task tops the Backlog.
const BOARD: BoardData = {
  open: [
    { name: "new", task: NEW_TASK.id, action: "Start Builder" },
    { task: "b8t1", action: "Start Builder" },
    { task: "q7d1", action: "Start Spec" },
    { task: "m2q7", action: "Start Spec" },
    { task: "w5j3", action: "Start Builder" },
  ],
  spec_ready: [{ task: "h5w3", action: "Start Planner" }],
};

/** JSON in the colors of the log. The task id of the result has a hook for its highlight. */
function Json({
  tokens,
  ...attributes
}: ComponentProps<"p"> & { tokens: readonly JsonToken[] }): ReactElement {
  return (
    <p className="mcp-json" {...attributes}>
      {tokens.map((token, index) => (
        <span
          className={token.kind}
          data-hit={token.text === ID_TEXT ? "" : undefined}
          // The tokens never change order, so the index is a stable key.
          key={index}
        >
          {token.text}
        </span>
      ))}
    </p>
  );
}

/** The client: its config, the request, the tool call, and its result. */
function McpClient(): ReactElement {
  return (
    <div className="mcp-client" data-mcp-client="">
      <div className="mcp-head">
        <span>
          <Plug className="i14" />
          MCP client
        </span>
        <code>stdio</code>
      </div>
      <div className="mcp-config">
        <span className="mcp-file">
          <FileBraces className="i12" />
          mcp.json
        </span>
        <Json tokens={ENTRY.slice(1, -1)} />
      </div>
      <div className="mcp-log">
        <p className="mcp-ask">
          <span className="mcp-mark">›</span>
          <span className="typed" data-prompt="">
            {PROMPT}
          </span>
        </p>
        <div className="mcp-step" data-call="">
          <p className="mcp-line" data-call-line="">
            <ArrowRight className="i12 mcp-dir" />
            <LoaderCircle className="i12 spin mcp-spin" />
            <b>odt_create_task</b>
            <span>openducktor</span>
          </p>
          <Json tokens={CALL} data-args="" />
        </div>
        <div className="mcp-step" data-result="">
          <p className="mcp-line">
            <ArrowLeft className="i12 mcp-dir" />
            <b>result</b>
            <span>41 ms</span>
          </p>
          <Json tokens={RESULT_TOKENS} />
        </div>
      </div>
    </div>
  );
}

export function McpView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="mcp"
      alt="An MCP client that uses the openducktor server with the default workspace fieldnotes. The visitor asks it to file a bug about tags that drop when a note moves. The client calls odt_create_task, and the result holds the new task fieldnotes-h4t8. At the same time, the task shows at the top of the Backlog lane on the OpenDucktor board."
    >
      <Replica className="mcp-scene">
        <McpClient />
        <AppWindow chrome={{ sidebar: "none" }} nested className="mcp-board">
          <BoardHead compact />
          <Board board={BOARD} lanes={["open", "spec_ready"]} />
        </AppWindow>
      </Replica>
    </SceneFrame>
  );
}
