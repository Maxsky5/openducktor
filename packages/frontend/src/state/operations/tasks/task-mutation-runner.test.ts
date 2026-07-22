import { describe, expect, test } from "bun:test";
import { executeTaskMutation } from "./task-mutation-runner";

describe("executeTaskMutation", () => {
  test("reports a refresh failure after the mutation remains committed", async () => {
    let mutations = 0;
    const refreshError = new Error("Refresh failed");

    const result = await executeTaskMutation({
      run: async () => {
        mutations += 1;
      },
      refresh: async () => {
        throw refreshError;
      },
    });

    expect(mutations).toBe(1);
    expect(result).toEqual({ refreshError });
  });

  test("still rejects when the mutation itself fails", async () => {
    const mutationError = new Error("Save failed");

    await expect(
      executeTaskMutation({
        run: async () => {
          throw mutationError;
        },
        refresh: async () => {},
      }),
    ).rejects.toBe(mutationError);
  });
});
