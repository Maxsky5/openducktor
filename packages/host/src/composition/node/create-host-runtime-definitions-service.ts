import {
  createRuntimeDefinitionsService,
  type RuntimeDefinitionsService,
} from "../../application/runtimes/runtime-definitions-service";

export const createHostRuntimeDefinitionsService = (): RuntimeDefinitionsService =>
  createRuntimeDefinitionsService();
