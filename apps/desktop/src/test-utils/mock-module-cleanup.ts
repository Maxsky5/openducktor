import { mock } from "bun:test";

export type MockedModuleReset = readonly [moduleId: string, loadActual: () => Promise<unknown>];

export const restoreMockedModules = async (
  entries: ReadonlyArray<MockedModuleReset>,
): Promise<void> => {
  for (const [moduleId, loadActual] of entries) {
    const actualModule = await loadActual();
    mock.module(moduleId, () => ({ ...(actualModule as Record<string, unknown>) }));
  }
};
