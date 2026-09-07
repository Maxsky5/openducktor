import { CODEX_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { AgentChatImageGeneration } from "../../src/components/features/agents/agent-chat/agent-chat-image-generation";
import { AgentChatImageSessionContext } from "../../src/components/features/agents/agent-chat/agent-chat-image-session-context";
import {
  AgentOperationsContext,
  RuntimeDefinitionsContext,
} from "../../src/state/app-state-contexts";
import "../../src/styles.css";

// Use real image decoding, production components, and production CSS. Only the host read is fake.
const canvas = document.createElement("canvas");
canvas.width = 800;
canvas.height = 600;
const context = canvas.getContext("2d");
context.fillStyle = "#facc15";
context.fillRect(0, 0, 800, 600);
const base64 = canvas.toDataURL("image/png").split(",")[1];
const revisedPrompt =
  "A detailed yellow duck beside a quiet lake with reeds and reflected morning light. ".repeat(60);
const sessionRef = {
  repoPath: "/fixture",
  workingDirectory: "/fixture",
  runtimeKind: "codex",
  externalSessionId: "preview",
};
const part = {
  kind: "image_generation",
  itemId: "image",
  messageId: "image",
  partId: "image",
  status: new URLSearchParams(location.search).has("running") ? "running" : "completed",
  revisedPrompt,
  savedPath: "/runtime/generated/duck.png",
  transparentBackground: false,
  output: { itemId: "image", representation: "inline" },
};
const operations = {
  readGeneratedImage: async (input) => ({
    ...input,
    mime: "image/png",
    base64,
    byteLength: atob(base64).length,
  }),
};
const definitions = { runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR] };
const client = new QueryClient();
createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={client}>
    <RuntimeDefinitionsContext.Provider value={definitions}>
      <AgentOperationsContext.Provider value={operations}>
        <AgentChatImageSessionContext.Provider value={sessionRef}>
          <AgentChatImageGeneration part={part} />
        </AgentChatImageSessionContext.Provider>
      </AgentOperationsContext.Provider>
    </RuntimeDefinitionsContext.Provider>
  </QueryClientProvider>,
);
