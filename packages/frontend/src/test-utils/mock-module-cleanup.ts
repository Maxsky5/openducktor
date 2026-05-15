import { mock } from "bun:test";

export type MockedModuleReset = readonly [moduleId: string, loadActual: () => Promise<unknown>];

export const restoreMockedModules = async (
  entries: ReadonlyArray<MockedModuleReset>,
): Promise<void> => {
  const restoredModules = await Promise.all(
    entries.map(async ([moduleId, loadActual]) => ({
      moduleId,
      actualModule: await loadActual(),
    })),
  );

  for (const { moduleId, actualModule } of restoredModules) {
    mock.module(moduleId, () => ({ ...(actualModule as Record<string, unknown>) }));
  }
};
