import type { AgentNativeFileReference, AgentToolResultContent } from "@openducktor/contracts";
import { buildContentEntries } from "./agent-chat-content-keys";
import { AgentNativeFileReferenceView } from "./agent-native-file-reference";
import { formatRawJsonLikeText } from "./agent-chat-message-card-model";

const nativeFileIdentity = (file: AgentNativeFileReference): string =>
  JSON.stringify(["file", file.uri, file.name, file.mime]);

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
  const entries = buildContentEntries(content, (item) =>
    item.kind === "text" ? JSON.stringify(["text", item.text]) : nativeFileIdentity(item.file),
  );
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
