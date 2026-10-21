import { MousePointerClick } from "lucide-react";
import type { ReactElement } from "react";
import { ActionToolCard } from "./agent-chat-action-tool-card";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { hasNonEmptyText } from "./tool-lifecycle";

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
  const action = meta.computerUse;
  return (
    <ActionToolCard
      meta={meta}
      messageTimestamp={messageTimestamp}
      timeLabel={timeLabel}
      icon={MousePointerClick}
      label="Computer Use"
      title={action?.action ?? "Computer action"}
      screenshots={(action?.images ?? []).map(
        (image) => `data:${image.mimeType};base64,${image.dataBase64}`,
      )}
      sections={[
        { label: "JavaScript", text: action?.code ?? "" },
        { label: "Error", text: hasNonEmptyText(meta.error) ? meta.error : "", tone: "error" },
        { label: "Output", text: hasNonEmptyText(meta.output) ? meta.output : "" },
      ]}
    />
  );
};
