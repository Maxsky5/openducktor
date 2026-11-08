import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { MessageSquare } from "lucide-react";
import type { ReactElement } from "react";

/**
 * A message that the reader can copy and send to an agent. It is prose, so its lines wrap at the
 * width of the page, as in the composer. A code block keeps its lines and scrolls instead.
 */
export function AgentMessage({ children }: { children: string }): ReactElement {
  return (
    <CodeBlock title="Message to the agent" icon={<MessageSquare className="size-3.5" />}>
      <Pre className="docs-agent-message">
        <code>{children.trim()}</code>
      </Pre>
    </CodeBlock>
  );
}
