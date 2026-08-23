import { describe, expect, test } from "bun:test";
import {
  readClaudeBackgroundAgentLaunch,
  readClaudeTaskNotification,
  readClaudeTaskNotifications,
} from "./claude-agent-sdk-runtime-messages";
import { claudeSessionMessageFixture } from "./claude-agent-sdk-test-messages";

describe("Claude runtime control messages", () => {
  test("reads the SDK task-notification envelope", () => {
    expect(
      readClaudeTaskNotification(
        claudeSessionMessageFixture({
          type: "user",
          uuid: "user-1",
          message: {
            role: "user",
            content: `<task-notification>
<task-id>agent-1</task-id>
<tool-use-id>agent-tool-1</tool-use-id>
<output-file>/tmp/agent-1.output</output-file>
<status>completed</status>
<summary>Agent finished</summary>
</task-notification>`,
          },
        }),
      ),
    ).toEqual({
      taskId: "agent-1",
      toolUseId: "agent-tool-1",
      outputFile: "/tmp/agent-1.output",
      status: "completed",
      summary: "Agent finished",
    });
  });

  test("reads the SDK background Agent launch result", () => {
    expect(
      readClaudeBackgroundAgentLaunch(`Async agent launched successfully. (internal metadata)
agentId: child-agent (internal ID - do not mention to user.)
The agent is working in the background.
output_file: /tmp/child-agent.output`),
    ).toEqual({
      agentId: "child-agent",
      outputFile: "/tmp/child-agent.output",
      status: "async_launched",
    });
  });

  test("reads every task from a grouped stopped notification without a tool-use id", () => {
    expect(
      readClaudeTaskNotifications(
        claudeSessionMessageFixture({
          type: "user",
          uuid: "user-2",
          message: {
            role: "user",
            content: `<task-notification>
<task-id>agent-1</task-id>
<task-id>agent-2</task-id>
<status>stopped</status>
</task-notification>`,
          },
        }),
      ),
    ).toEqual([
      { taskId: "agent-1", status: "stopped" },
      { taskId: "agent-2", status: "stopped" },
    ]);
  });

  test("does not classify ordinary user or tool-result text as runtime control messages", () => {
    expect(
      readClaudeTaskNotification(
        claudeSessionMessageFixture({
          type: "user",
          uuid: "user-3",
          message: { role: "user", content: "Tell me about <task-notification> messages." },
        }),
      ),
    ).toBeNull();
    expect(readClaudeBackgroundAgentLaunch("The agent launched successfully.")).toBeNull();
  });
});
