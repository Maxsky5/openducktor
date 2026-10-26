import type { AgentToolResultContent } from "@openducktor/contracts";
import { toolResultContentEntries } from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import { AgentNativeFileReferenceView } from "./agent-native-file-reference";
import { formatRawJsonLikeText } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model";

export function AgentToolResultContentView({
  content,
  output,
}: {
  content?: AgentToolResultContent[] | undefined;
  output?: string | undefined;
}) {
  if (!content)
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap">
        {formatRawJsonLikeText(output ?? "")}
      </pre>
    );
  const entries = toolResultContentEntries(content);
  return entries.map(({ value, key }) =>
    value.kind === "text" ? (
      <pre key={key} className="overflow-x-auto whitespace-pre-wrap">
        {value.text}
      </pre>
    ) : (
      <AgentNativeFileReferenceView key={key} file={value.file} />
    ),
  );
}
