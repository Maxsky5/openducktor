import { Globe } from "lucide-react";
import type { ReactElement } from "react";
import { ActionToolCard } from "./agent-chat-action-tool-card";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { browserToolScreenshots, browserToolTitle } from "./browser-tool-summary";
import { hasNonEmptyInput, hasNonEmptyText } from "./tool-lifecycle";

type BrowserToolMessageProps = {
  meta: ToolMeta;
  /** The browser action, such as `click`. */
  action: string;
  messageTimestamp: string;
  timeLabel: string;
};

/** One `odt_browser_*` call: its action, the screenshot it took, and its input and result. */
export const BrowserToolMessage = ({
  meta,
  action,
  messageTimestamp,
  timeLabel,
}: BrowserToolMessageProps): ReactElement => (
  <ActionToolCard
    meta={meta}
    messageTimestamp={messageTimestamp}
    timeLabel={timeLabel}
    icon={Globe}
    label="Browser"
    title={browserToolTitle(action, meta.input)}
    screenshots={browserToolScreenshots(meta.resultContent)}
    sections={[
      {
        label: "Input",
        text: hasNonEmptyInput(meta.input) ? JSON.stringify(meta.input, null, 2) : "",
      },
      { label: "Error", text: hasNonEmptyText(meta.error) ? meta.error : "", tone: "error" },
      { label: "Output", text: hasNonEmptyText(meta.output) ? meta.output : "" },
    ]}
  />
);
