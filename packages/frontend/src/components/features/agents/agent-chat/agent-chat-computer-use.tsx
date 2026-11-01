import { MousePointerClick } from "lucide-react";
import type { ReactElement } from "react";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import {
  buildComputerUsePresentation,
  computerUseScreenshotUri,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import { ActionToolCard, type ActionToolSection } from "./agent-chat-action-tool-card";

type ComputerUseToolMessageProps = {
  meta: ToolMeta;
  messageTimestamp: string;
  timeLabel: string;
};

export const ComputerUseToolMessage = ({
  meta,
  messageTimestamp,
  timeLabel,
}: ComputerUseToolMessageProps): ReactElement => {
  const { actionTitle, screenshots } = buildComputerUsePresentation(meta);
  return (
    <ActionToolCard
      meta={meta}
      messageTimestamp={messageTimestamp}
      timeLabel={timeLabel}
      icon={MousePointerClick}
      label="Computer Use"
      title={actionTitle}
      screenshots={{
        count: screenshots.length,
        sources: screenshots.map(computerUseScreenshotUri),
      }}
      sections={computerUseSections}
    />
  );
};

const computerUseSections = (meta: ToolMeta): ActionToolSection[] => {
  const { code, errorText, outputText } = buildComputerUsePresentation(meta);
  return [
    { label: "JavaScript", text: code },
    { label: "Error", text: errorText, tone: "error" },
    { label: "Output", text: outputText },
  ];
};
