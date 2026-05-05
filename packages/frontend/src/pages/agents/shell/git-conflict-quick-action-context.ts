import type { AgentStudioGitConflictQuickActionContext } from "../use-agents-page-right-panel-model";

const stringArraysEqual = (left: string[], right: string[]): boolean => {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
};

export const gitConflictQuickActionContextsEqual = (
  left: AgentStudioGitConflictQuickActionContext | null,
  right: AgentStudioGitConflictQuickActionContext | null,
): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  const leftConflict = left.conflict;
  const rightConflict = right.conflict;

  return (
    left.isHandling === right.isHandling &&
    leftConflict.operation === rightConflict.operation &&
    leftConflict.currentBranch === rightConflict.currentBranch &&
    leftConflict.targetBranch === rightConflict.targetBranch &&
    leftConflict.workingDir === rightConflict.workingDir &&
    leftConflict.output === rightConflict.output &&
    stringArraysEqual(leftConflict.conflictedFiles, rightConflict.conflictedFiles)
  );
};
