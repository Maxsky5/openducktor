import { runtimeExecutableCheckInputSchema } from "@openducktor/contracts";
import type { RuntimeExecutableCheckService } from "../../application/runtimes/runtime-executable-check-service";
import { defineHostCommandHandlers } from "../router/host-command-router";

export const createRuntimeExecutableCommandHandlers = (service: RuntimeExecutableCheckService) =>
  defineHostCommandHandlers({
    runtime_executables_check: (args) =>
      service.check(runtimeExecutableCheckInputSchema.parse(args)),
  });
