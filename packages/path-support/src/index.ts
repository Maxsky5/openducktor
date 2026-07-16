export {
  basenameForPath,
  type CanonicalPathPlatform,
  canonicalPathsEqual,
  isAbsolutePath,
  normalizePathForComparison,
  normalizePathSeparators,
  pathStartsWith,
  resolveAgainstWorkingDirectory,
  toDisplayRelativePath,
  toProjectRelativePath,
  trimTrailingPathSeparators,
} from "./lexical-path";
export {
  normalizeUserPathInput,
  type ResolveUserPathOptions,
  resolveNormalizedUserPath,
  resolveUserPath,
} from "./user-path";
