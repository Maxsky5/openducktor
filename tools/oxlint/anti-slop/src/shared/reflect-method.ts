import type { ESTree, SourceCode } from "@oxlint/plugins";
import { isCallableMemberReference } from "./callable-member.ts";
import { isGlobalObjectReference } from "./global-reference.ts";

/** Reports whether a call target names one method on the global Reflect object. */
export function isGlobalReflectMethodCall(
  sourceCode: SourceCode,
  callee: ESTree.Expression,
  methodName: string,
): boolean {
  return isCallableMemberReference(
    sourceCode,
    callee,
    (object, objectPath, propertyName) =>
      objectPath.length === 0 &&
      propertyName === methodName &&
      isGlobalObjectReference(sourceCode, object, "Reflect"),
  );
}
