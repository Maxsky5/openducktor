import { describe, expect, test } from "bun:test";
import { buildBackgroundTaskRows } from "@openducktor/frontend-core/sessions/background-tasks/background-task-bar";
import type { Confirm } from "@/ui/confirm-dialog";
import { confirmBackgroundTaskStop } from "./background-task-bar-state";

const [server] = buildBackgroundTaskRows(
  [{ taskId: "shell-1", kind: "command", title: "bun run dev", stop: { allowed: true } }],
  new Map(),
);
if (!server) throw new Error("The fixture has one row.");

const answering = (answer: boolean) => {
  const questions: Parameters<Confirm>[0][] = [];
  const confirm: Confirm = async (options) => {
    questions.push(options);
    return answer;
  };
  return { confirm, questions };
};

describe("confirmBackgroundTaskStop", () => {
  test("asks with the words of the row and stops the task after the user confirms", async () => {
    const { confirm, questions } = answering(true);
    const stopped: string[] = [];

    await confirmBackgroundTaskStop(confirm, server, (taskId) => stopped.push(taskId));

    expect(questions).toEqual([
      {
        title: "Stop this command?",
        message: 'The command "bun run dev" stops. The agent and the other tasks continue.',
        confirmLabel: "Stop",
        icon: "square",
        destructive: true,
      },
    ]);
    expect(stopped).toEqual(["shell-1"]);
  });

  test("sends nothing when the user cancels", async () => {
    const { confirm } = answering(false);
    const stopped: string[] = [];

    await confirmBackgroundTaskStop(confirm, server, (taskId) => stopped.push(taskId));

    expect(stopped).toEqual([]);
  });

  test("asks again after a failed stop, and never while the stop runs", async () => {
    const { confirm, questions } = answering(true);
    const stopped: string[] = [];
    const stop = (taskId: string) => stopped.push(taskId);

    await confirmBackgroundTaskStop(
      confirm,
      { ...server, stop: { control: { label: "Stopping", busy: true }, note: null } },
      stop,
    );
    await confirmBackgroundTaskStop(
      confirm,
      {
        ...server,
        stop: {
          control: { label: "Stop", busy: false },
          note: { text: "Shell not found", tone: "error" },
        },
      },
      stop,
    );

    expect(questions).toHaveLength(1);
    expect(stopped).toEqual(["shell-1"]);
  });
});
