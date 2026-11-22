import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { methods } from "@agentclientprotocol/sdk/unstable";
import type { AgentTextGenerationInput } from "@openducktor/contracts";
import type { AntigravityAgentConnection } from "./antigravity-agent-connection";
import { antigravitySystemPromptMeta } from "./antigravity-native-contract";
import type {
  AntigravitySessionRegistry,
  AntigravitySideSession,
} from "./antigravity-session-registry";
import { setAntigravityNativeModel } from "./antigravity-session-model";

const TOOL_REFUSAL =
  "Antigravity tried to use a tool or to ask a question while it generated text. Try again, or choose another naming model.";

/**
 * Generates one text on the shared `agy acp` process. ACP has no session-free model call and no
 * switch that turns off tools, so the generation opens a session in a new empty directory, with
 * the instructions as its system prompt and no MCP servers, and fails when the runtime asks for a
 * tool or for input. Antigravity keeps the session in its own history.
 */
export const generateAntigravityText = async (
  connection: AntigravityAgentConnection,
  sessions: AntigravitySessionRegistry,
  input: AgentTextGenerationInput,
  signal: AbortSignal,
): Promise<string> => {
  const agent = connection.agent();
  const directory = await mkdtemp(join(tmpdir(), "openducktor-antigravity-text-"));
  let sessionId: string | null = null;
  let refused = false;
  let text = "";
  let failed = true;
  try {
    const session = await connection.request(() =>
      agent.request(methods.agent.session.new, {
        cwd: directory,
        mcpServers: [],
        _meta: antigravitySystemPromptMeta(input.instructions),
      }),
    );
    const id = session.sessionId;
    sessionId = id;
    const cancel = () => void agent.notify(methods.agent.session.cancel, { sessionId: id });
    // A refused request ends the turn as Stop does, and the generation fails after its answer.
    const refuse = () => {
      if (refused) return;
      refused = true;
      cancel();
    };
    const sideSession: AntigravitySideSession = {
      applyUpdate: (update) => {
        if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
          refuse();
        } else if (
          update.sessionUpdate === "agent_message_chunk" &&
          update.content.type === "text"
        ) {
          text += update.content.text;
        }
      },
      refuse,
    };
    await sessions.withSideSession(id, sideSession, async () => {
      await setAntigravityNativeModel(connection, id, input.model);
      signal.throwIfAborted();
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const response = await connection.request(() =>
          agent.request(methods.agent.session.prompt, {
            sessionId: id,
            prompt: [{ type: "text", text: input.prompt }],
          }),
        );
        if (refused) throw new Error(TOOL_REFUSAL);
        signal.throwIfAborted();
        if (response.stopReason !== "end_turn") {
          throw new Error(`Antigravity ended the text generation with ${response.stopReason}.`);
        }
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    });
    failed = false;
  } finally {
    if (sessionId) {
      const id = sessionId;
      // A failed close after a failed generation must not hide the first failure.
      await connection
        .request(() => agent.request(methods.agent.session.close, { sessionId: id }))
        .catch((cause: unknown) => {
          if (!failed) throw cause;
        });
    }
    await rm(directory, { recursive: true, force: true });
  }
  const answer = text.trim();
  if (!answer) throw new Error("Antigravity returned no text.");
  return answer;
};
