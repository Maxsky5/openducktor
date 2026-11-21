import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import type { RuntimeDefinitionsService } from "../../application/runtimes/runtime-definitions-service";
import {
  type CreateHostCommandRouterInput,
  createEffectHostCommandRouter,
  toPromiseHostCommandRouter,
} from "../router/host-command-router";

import { createRuntimeDefinitionsCommandHandlers } from "./runtime-definitions-command-handlers";

const createHostCommandRouter = (input: CreateHostCommandRouterInput) =>
  toPromiseHostCommandRouter(createEffectHostCommandRouter(input));

describe("createRuntimeDefinitionsCommandHandlers", () => {
  test.each([undefined, {}])("lists runtime definitions with args %p", async (args) => {
    const service: RuntimeDefinitionsService = {
      listRuntimeDefinitions() {
        return [RUNTIME_DESCRIPTORS_BY_KIND.opencode];
      },
    };
    const router = createHostCommandRouter({
      handlers: createRuntimeDefinitionsCommandHandlers(service),
    });
    await expect(router.invoke("runtime_definitions_list", args)).resolves.toMatchObject([
      { kind: "opencode" },
    ]);
  });
  describe("invalid arguments", () => {
    const router = createHostCommandRouter({
      handlers: createRuntimeDefinitionsCommandHandlers({
        listRuntimeDefinitions() {
          throw new Error("should not call runtime definitions service");
        },
      }),
    });

    test.each([
      { key: "force", args: { force: true } },
      { key: "__proto__", args: { ["__proto__"]: true } },
    ])("rejects an argument named $key", async ({ args }) => {
      await expect(router.invoke("runtime_definitions_list", args)).rejects.toMatchObject({
        _tag: "HostValidationError",
        message: "runtime_definitions_list does not accept arguments.",
        field: "args",
        details: { command: "runtime_definitions_list" },
      });
    });

    test("rejects an empty array", async () => {
      // @ts-expect-error Verify validation for an untyped caller.
      const result = router.invoke("runtime_definitions_list", []);
      await expect(result).rejects.toMatchObject({
        _tag: "HostValidationError",
        message: "runtime_definitions_list input must be an object.",
        field: "runtime_definitions_list input",
      });
    });
  });
});
