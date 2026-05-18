import type { TaskCard } from "@openducktor/contracts";

const TASK_LIST_CACHE_TTL_MS = 2000;

type TaskListCacheEntry = {
  cachedAt: number;
  tasks: TaskCard[];
};

type TaskListCacheState = {
  entry: TaskListCacheEntry | null;
  generation: number;
  repoPath: string;
};

export const cloneTasks = (tasks: TaskCard[]): TaskCard[] =>
  tasks.map((task) => structuredClone(task) as TaskCard);

export const createTaskListCache = () => {
  const entries = new Map<string, TaskListCacheState>();

  const cacheKey = (repoPath: string, doneVisibleDays: number | undefined): string =>
    `${repoPath}\0${doneVisibleDays === undefined ? "all" : doneVisibleDays.toString()}`;

  const stateFor = (repoPath: string, doneVisibleDays: number | undefined): TaskListCacheState => {
    const key = cacheKey(repoPath, doneVisibleDays);
    const existing = entries.get(key);
    if (existing) {
      return existing;
    }
    const state: TaskListCacheState = {
      entry: null,
      generation: 0,
      repoPath,
    };
    entries.set(key, state);
    return state;
  };

  const cachedTaskListAndGeneration = (
    repoPath: string,
    doneVisibleDays: number | undefined,
    nowMs: number,
  ): {
    generation: number;
    tasks: TaskCard[] | null;
  } => {
    const state = stateFor(repoPath, doneVisibleDays);
    if (state.entry && nowMs - state.entry.cachedAt <= TASK_LIST_CACHE_TTL_MS) {
      return { generation: state.generation, tasks: cloneTasks(state.entry.tasks) };
    }
    state.entry = null;
    return { generation: state.generation, tasks: null };
  };

  const cacheTaskListIfGeneration = (
    repoPath: string,
    doneVisibleDays: number | undefined,
    generation: number,
    tasks: TaskCard[],
    nowMs: number,
  ): void => {
    const state = stateFor(repoPath, doneVisibleDays);
    if (state.generation !== generation) {
      return;
    }
    state.entry = {
      cachedAt: nowMs,
      tasks: cloneTasks(tasks),
    };
  };

  const invalidateTaskListCache = (repoPath: string): void => {
    for (const state of entries.values()) {
      if (state.repoPath !== repoPath) {
        continue;
      }
      state.generation += 1;
      state.entry = null;
    }
  };

  return {
    cacheTaskListIfGeneration,
    cachedTaskListAndGeneration,
    invalidateTaskListCache,
  };
};
