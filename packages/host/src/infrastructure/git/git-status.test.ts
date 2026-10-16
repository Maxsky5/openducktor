import { expect, test } from "bun:test";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import { GIT_OUTPUT_ENCODING_FIELD, type GitCommandRunner } from "./git-command-runner";
import { readLocalChangesStatusPorcelain } from "./git-status";

test("the local changes status read names the step to take for a name that is not UTF-8", async () => {
  const runner: GitCommandRunner = (_directory, _args, options) =>
    options?.strictUtf8
      ? Effect.fail(
          new HostValidationError({
            message: "git status wrote output that is not UTF-8 text.",
            field: GIT_OUTPUT_ENCODING_FIELD,
          }),
        )
      : Effect.succeed({ ok: true, stdout: "?? bad-�.txt\0", stderr: "" });

  const failure = await Effect.runPromise(
    Effect.flip(readLocalChangesStatusPorcelain(runner, "/repo")),
  );

  expect(failure).toMatchObject({
    field: "fileName",
    message:
      "Git lists a file in /repo whose name is not UTF-8 text. Rename the file to a UTF-8 name, then refresh.",
  });
});
