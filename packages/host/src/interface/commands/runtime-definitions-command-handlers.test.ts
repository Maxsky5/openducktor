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
  test("routes runtime_definitions_list through the runtime definitions service", async () => {
    const service: RuntimeDefinitionsService = {
      listRuntimeDefinitions() {
        return [RUNTIME_DESCRIPTORS_BY_KIND.opencode];
      },
    };
    const router = createHostCommandRouter({
      handlers: createRuntimeDefinitionsCommandHandlers(service),
    });
    await expect(router.invoke("runtime_definitions_list", {})).resolves.toMatchObject([
      { kind: "opencode" },
    ]);
  });
  test("rejects malformed runtime definitions args", async () => {
    const service: RuntimeDefinitionsService = {
      listRuntimeDefinitions() {
        throw new Error("should not call runtime definitions service");
      },
    };
    const router = createHostCommandRouter({
      handlers: createRuntimeDefinitionsCommandHandlers(service),
    });
    await expect(router.invoke("runtime_definitions_list", { force: true })).rejects.toThrow(
      "runtime_definitions_list does not accept arguments.",
    );
  });
});
