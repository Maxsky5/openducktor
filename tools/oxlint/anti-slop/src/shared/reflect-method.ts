import type { ESTree, SourceCode } from "@oxlint/plugins";
import { isGlobalObjectReference } from "./global-reference.ts";

/** Reports whether a call target names one method on the global Reflect object. */
export function isGlobalReflectMethodCall(
  sourceCode: SourceCode,
  callee: ESTree.Expression,
  methodName: string,
): boolean {
  if (!("property" in callee) || !("object" in callee) || !("computed" in callee)) return false;
  if (!isGlobalObjectReference(sourceCode, callee.object, "Reflect")) return false;
  const property = callee.property;
  return callee.computed
    ? property.type === "Literal" && property.value === methodName
    : property.type === "Identifier" && property.name === methodName;
}
