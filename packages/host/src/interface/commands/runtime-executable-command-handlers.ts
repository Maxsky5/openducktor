import { runtimeExecutableCheckInputSchema } from "@openducktor/contracts";
import type { RuntimeExecutableCheckService } from "../../application/runtimes/runtime-executable-check-service";
import type { HostCommandHandlers } from "../router/host-command-router";

export const createRuntimeExecutableCommandHandlers = (
  service: RuntimeExecutableCheckService,
): HostCommandHandlers => ({
  runtime_executables_check: (args) => service.check(runtimeExecutableCheckInputSchema.parse(args)),
});
