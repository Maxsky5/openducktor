// The last answer of the Builder of the empty notebook task. The browser and annotate scenes start
// after it.
import type { ReactElement } from "react";
import { BUILDER_REPLY, BUILDER_WORKED } from "../../sample/browser";
import { signature } from "../../sample/sessions";
import { BUILDER_SESSION } from "../../sample/studio";
import { AgentText } from "../transcript/AgentText";
import { Paragraph } from "../ui/InlineCode";

export function BuilderReply(): ReactElement {
  return (
    <AgentText signature={signature(BUILDER_SESSION)} worked={BUILDER_WORKED} row="earlier">
      <Paragraph text={BUILDER_REPLY} />
    </AgentText>
  );
}
