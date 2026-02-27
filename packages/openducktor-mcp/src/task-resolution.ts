import { sanitizeSlug } from "./beads-runtime";
import type { TaskCard } from "./contracts";

export interface TaskIndex {
  tasks: TaskCard[];
  entries: TaskIndexEntry[];
  idExact: Map<string, TaskCard>;
  idLower: Map<string, TaskCard[]>;
  idSuffix: Map<string, TaskCard[]>;
  titleExact: Map<string, TaskCard[]>;
  titleSlug: Map<string, TaskCard[]>;
}

interface TaskIndexEntry {
  task: TaskCard;
  idLower: string;
  titleLower: string;
  titleSlug: string;
}

const MAX_TASK_CANDIDATES = 5;

const formatTaskRef = (task: TaskCard): string => `${task.id} (${task.title})`;

export class TaskResolutionAmbiguousError extends Error {
  readonly requestedTaskId: string;
  readonly candidates: string[];

  constructor(requestedTaskId: string, candidates: string[]) {
    super(
      `Task identifier "${requestedTaskId}" is ambiguous. Use exact task id. Candidates: ${candidates.join(", ")}`,
    );
    this.name = "TaskResolutionAmbiguousError";
    this.requestedTaskId = requestedTaskId;
    this.candidates = candidates;
  }
}

export class TaskResolutionNotFoundError extends Error {
  readonly requestedTaskId: string;
  readonly candidates: string[];

  constructor(requestedTaskId: string, candidates: string[]) {
    const hintSuffix = candidates.length > 0 ? ` Candidate task ids: ${candidates.join(", ")}` : "";
    super(`Task not found: ${requestedTaskId}.${hintSuffix}`);
    this.name = "TaskResolutionNotFoundError";
    this.requestedTaskId = requestedTaskId;
    this.candidates = candidates;
  }
}

export const normalizeTitleKey = (value: string): string => value.trim().toLowerCase();

export const toSearchSlug = (value: string): string => {
  if (!/[a-z0-9]/i.test(value)) {
    return "";
  }
  return sanitizeSlug(value);
};

function throwAmbiguousTaskIdentifier(requestedTaskId: string, matches: TaskCard[]): never {
  const candidates = matches.slice(0, MAX_TASK_CANDIDATES).map(formatTaskRef);
  throw new TaskResolutionAmbiguousError(requestedTaskId, candidates);
}

export function buildTaskIndex(tasks: TaskCard[]): TaskIndex {
  const idExact = new Map<string, TaskCard>();
  const idLower = new Map<string, TaskCard[]>();
  const idSuffix = new Map<string, TaskCard[]>();
  const titleExact = new Map<string, TaskCard[]>();
  const titleSlug = new Map<string, TaskCard[]>();
  const entries: TaskIndexEntry[] = [];

  const addTaskToBucket = (map: Map<string, TaskCard[]>, key: string, task: TaskCard): void => {
    const existing = map.get(key);
    if (existing) {
      existing.push(task);
    } else {
      map.set(key, [task]);
    }
  };

  for (const task of tasks) {
    const normalizedId = normalizeTitleKey(task.id);
    const normalizedTitle = normalizeTitleKey(task.title);
    const normalizedTitleSlug = toSearchSlug(task.title);

    idExact.set(task.id, task);
    addTaskToBucket(idLower, normalizedId, task);

    addTaskToBucket(idSuffix, normalizedId, task);
    for (let i = 0; i < normalizedId.length; i += 1) {
      if (normalizedId[i] !== "-") {
        continue;
      }
      const suffix = normalizedId.slice(i + 1);
      if (suffix.length > 0) {
        addTaskToBucket(idSuffix, suffix, task);
      }
    }

    addTaskToBucket(titleExact, normalizedTitle, task);
    if (normalizedTitleSlug.length > 0) {
      addTaskToBucket(titleSlug, normalizedTitleSlug, task);
    }

    entries.push({
      task,
      idLower: normalizedId,
      titleLower: normalizedTitle,
      titleSlug: normalizedTitleSlug,
    });
  }

  return {
    tasks,
    entries,
    idExact,
    idLower,
    idSuffix,
    titleExact,
    titleSlug,
  };
}

export function resolveTaskFromIndex(index: TaskIndex, requestedTaskId: string): TaskCard {
  const requestedLiteral = requestedTaskId.trim();
  if (requestedLiteral.length === 0) {
    throw new Error("Missing taskId.");
  }

  const requestedLower = normalizeTitleKey(requestedLiteral);
  const requestedSlug = toSearchSlug(requestedLiteral);

  const exact = index.idExact.get(requestedLiteral);
  if (exact) {
    return exact;
  }

  const byCaseInsensitiveId = index.idLower.get(requestedLower);
  if (byCaseInsensitiveId) {
    if (byCaseInsensitiveId.length === 1 && byCaseInsensitiveId[0]) {
      return byCaseInsensitiveId[0];
    }
    if (byCaseInsensitiveId.length > 1) {
      throwAmbiguousTaskIdentifier(requestedTaskId, byCaseInsensitiveId);
    }
  }

  if (requestedSlug.length > 0) {
    const byIdSuffix = index.idSuffix.get(requestedSlug);
    if (byIdSuffix?.length === 1 && byIdSuffix[0]) {
      return byIdSuffix[0];
    }
    if (byIdSuffix && byIdSuffix.length > 1) {
      throwAmbiguousTaskIdentifier(requestedTaskId, byIdSuffix);
    }
  }

  const byTitleExact = index.titleExact.get(requestedLower);
  if (byTitleExact) {
    if (byTitleExact.length === 1 && byTitleExact[0]) {
      return byTitleExact[0];
    }
    if (byTitleExact.length > 1) {
      throwAmbiguousTaskIdentifier(requestedTaskId, byTitleExact);
    }
  }

  if (requestedSlug.length > 0) {
    const byTitleSlugExact = index.titleSlug.get(requestedSlug);
    if (byTitleSlugExact) {
      if (byTitleSlugExact.length === 1 && byTitleSlugExact[0]) {
        return byTitleSlugExact[0];
      }
      if (byTitleSlugExact.length > 1) {
        throwAmbiguousTaskIdentifier(requestedTaskId, byTitleSlugExact);
      }
    }
  }

  const byTitleContains: TaskCard[] = [];
  if (requestedLower.length > 0 || requestedSlug.length > 0) {
    for (const entry of index.entries) {
      const matchesLower = requestedLower.length > 0 && entry.titleLower.includes(requestedLower);
      const matchesSlug = requestedSlug.length > 0 && entry.titleSlug.includes(requestedSlug);

      if (matchesLower || matchesSlug) {
        byTitleContains.push(entry.task);
        if (byTitleContains.length > MAX_TASK_CANDIDATES) {
          break;
        }
      }
    }
  }

  if (byTitleContains.length === 1 && byTitleContains[0]) {
    return byTitleContains[0];
  }
  if (byTitleContains.length > 1) {
    throwAmbiguousTaskIdentifier(requestedTaskId, byTitleContains);
  }

  const hints: TaskCard[] = [];
  if (requestedLower.length > 0 || requestedSlug.length > 0) {
    for (const entry of index.entries) {
      const matchesIdLower = requestedLower.length > 0 && entry.idLower.includes(requestedLower);
      const matchesTitleLower =
        requestedLower.length > 0 && entry.titleLower.includes(requestedLower);
      const matchesIdSlug = requestedSlug.length > 0 && entry.idLower.includes(requestedSlug);
      const matchesTitleSlug = requestedSlug.length > 0 && entry.titleSlug.includes(requestedSlug);

      if (matchesIdLower || matchesTitleLower || matchesIdSlug || matchesTitleSlug) {
        hints.push(entry.task);
        if (hints.length >= MAX_TASK_CANDIDATES) {
          break;
        }
      }
    }
  }

  const fallback = (hints.length > 0 ? hints : index.tasks.slice(0, MAX_TASK_CANDIDATES)).map(
    formatTaskRef,
  );
  throw new TaskResolutionNotFoundError(requestedTaskId, fallback);
}
