// The Usage page of packages/frontend/src/pages/usage in the app window, with the report of the
// last 30 days, cropped under the Highlights. The visitor opens it from the footer of the sidebar.
// The markup holds the last frame: the page shows the estimated cost. The Kanban board, where the
// visitor starts, waits hidden in the page area.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { Board } from "../../replicas/board/Board";
import { BoardHead } from "../../replicas/board/BoardHead";
import { AppWindow } from "../../replicas/shell/AppWindow";
import { Pointer } from "../../replicas/shell/Pointer";
import { formatCountOf, formatMetric } from "../../replicas/usage/format";
import { dayFigures, reportSessions, reportTotal } from "../../replicas/usage/model";
import { UsagePage } from "../../replicas/usage/UsagePage";
import { BOARD, CHART_WIDTHS, INSPECTED_DAY, NAV, REPORT } from "./sample";
import "./view.css";

const TOKENS = formatMetric(reportTotal(REPORT, "tokens"), "tokens");
const COST = formatMetric(reportTotal(REPORT, "cost"), "cost");
const SESSIONS = formatCountOf(reportSessions(REPORT), "session");
const DAY = dayFigures(REPORT, INSPECTED_DAY, "tokens").day;

export function UsageView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="usage"
      alt={`The OpenDucktor window shows the Kanban board. The visitor selects Usage in the footer of the sidebar. The Usage page shows its skeleton, then the report of the last 30 days: ${TOKENS} processed tokens in ${SESSIONS}, the part of Claude Code, Codex, OpenCode, and Antigravity, a chart of the daily tokens of each runtime and their total, and the Highlights. The visitor points at ${DAY}, the busiest day, and the tooltip shows the tokens of each runtime on that day. Then the visitor selects Cost. The page shows the estimated API cost of ${COST}, the cost of each runtime, and the daily cost in the chart. The visitor points at ${DAY} again, and the tooltip shows the cost of each runtime on that day.`}
    >
      <AppWindow
        chrome={{ sidebar: "full", nav: NAV, version: null, pinned: true, page: "usage" }}
        keys={props.keys}
        className="usage-window"
        pane="main"
        overlay={<Pointer />}
      >
        <div className="usage-board" data-board-page="" hidden>
          <BoardHead />
          <Board board={BOARD} />
        </div>
        <UsagePage report={REPORT} metric="cost" charts={CHART_WIDTHS} />
      </AppWindow>
    </SceneFrame>
  );
}
