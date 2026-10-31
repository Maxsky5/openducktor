import { useQueries } from "@tanstack/react-query";
import { Globe } from "lucide-react";
import { type ReactElement, useState } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { localImageDataUrl, localImageQueryOptions } from "@/state/queries/local-images";
import { ActionToolCard, type ActionToolSection } from "./agent-chat-action-tool-card";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { browserToolScreenshotPaths, browserToolTitle } from "./browser-tool-summary";
import {
  hasNonEmptyInput,
  hasNonEmptyText,
} from "@openducktor/frontend-core/sessions/messages/tool-lifecycle";

type BrowserToolMessageProps = {
  meta: ToolMeta;
  /** The browser action, such as `click`. */
  action: string;
  messageTimestamp: string;
  timeLabel: string;
};

/**
 * One `odt_browser_*` call: its action, the screenshot it saved, and its input and result. The
 * screenshot loads from the host when the user opens it.
 */
export const BrowserToolMessage = ({
  meta,
  action,
  messageTimestamp,
  timeLabel,
}: BrowserToolMessageProps): ReactElement => {
  const paths = browserToolScreenshotPaths(meta.output);
  const [requested, setRequested] = useState(false);
  const images = useQueries({
    queries: paths.map((path) => ({ ...localImageQueryOptions(path), enabled: requested })),
  });
  const sources = images.flatMap((image) =>
    image.isSuccess ? [localImageDataUrl(image.data)] : [],
  );
  const failure = images.find((image) => image.isError)?.error;
  return (
    <ActionToolCard
      meta={meta}
      messageTimestamp={messageTimestamp}
      timeLabel={timeLabel}
      icon={Globe}
      label="Browser"
      title={browserToolTitle(action, meta.input)}
      screenshots={{
        count: paths.length,
        sources: sources.length === paths.length && paths.length > 0 ? sources : null,
        load: () => setRequested(true),
        error: failure ? errorMessage(failure) : null,
      }}
      sections={browserToolSections}
    />
  );
};

const browserToolSections = (meta: ToolMeta): ActionToolSection[] => [
  {
    label: "Input",
    text: hasNonEmptyInput(meta.input) ? JSON.stringify(meta.input, null, 2) : "",
  },
  { label: "Error", text: hasNonEmptyText(meta.error) ? meta.error : "", tone: "error" },
  { label: "Output", text: hasNonEmptyText(meta.output) ? meta.output : "" },
];
