import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChatTranscriptProse } from "./agent-chat-transcript-prose";

const LONG_TRANSCRIPT_TOKEN =
  "supercalifragilisticexpialidocioussupercalifragilisticexpialidocious";

describe("AgentChatTranscriptProse", () => {
  test("keeps transcript prose whitespace-preserving and word-breaking", () => {
    const html = renderToStaticMarkup(
      <AgentChatTranscriptProse>{`Line one\n${LONG_TRANSCRIPT_TOKEN}`}</AgentChatTranscriptProse>,
    );

    expect(html).toContain(LONG_TRANSCRIPT_TOKEN);
    expect(html).toContain("whitespace-pre-wrap break-words");
  });

  test("merges caller classes after the transcript wrapping contract", () => {
    const html = renderToStaticMarkup(
      <AgentChatTranscriptProse className="text-sm text-muted-foreground">
        Status
      </AgentChatTranscriptProse>,
    );

    expect(html).toContain("whitespace-pre-wrap break-words text-sm text-muted-foreground");
  });
});
