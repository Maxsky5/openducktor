import type { WorkflowProblem, WorkflowProblemPath } from "@openducktor/contracts";

/** Collects the problems of one check, in the order that the check finds them. */
export type ProblemSink = {
  error(path: WorkflowProblemPath, message: string): void;
  warning(path: WorkflowProblemPath, message: string): void;
  readonly problems: WorkflowProblem[];
};

export const createProblemSink = (prefix: WorkflowProblemPath = []): ProblemSink => {
  const problems: WorkflowProblem[] = [];
  return {
    problems,
    error: (path, message) =>
      problems.push({ severity: "error", path: [...prefix, ...path], message }),
    warning: (path, message) =>
      problems.push({ severity: "warning", path: [...prefix, ...path], message }),
  };
};

/** The path in the dotted form of error messages, such as `steps[0].launchActions[1].id`. */
export const formatProblemPath = (path: WorkflowProblemPath): string => {
  let text = "";
  for (const part of path) {
    if (Number.isInteger(part)) text = `${text}[${part}]`;
    else text = text.length === 0 ? `${part}` : `${text}.${part}`;
  }
  return text;
};

/** The message of a thrown problem: the sentence and, when known, where it is. */
export const problemText = (problem: WorkflowProblem): string =>
  problem.path.length === 0
    ? problem.message
    : `${problem.message} (at ${formatProblemPath(problem.path)})`;

export const firstError = (problems: readonly WorkflowProblem[]): WorkflowProblem | undefined =>
  problems.find(({ severity }) => severity === "error");

/** A sink that adds a path prefix to each problem of another sink. */
export const prefixedSink = (sink: ProblemSink, prefix: WorkflowProblemPath): ProblemSink => ({
  problems: sink.problems,
  error: (path, message) => sink.error([...prefix, ...path], message),
  warning: (path, message) => sink.warning([...prefix, ...path], message),
});
