import type { ESTree, Variable } from "@oxlint/plugins";

/** A local const or unchanged let binding has one stable initializer. */
export function isStableBinding(
  variable: Variable,
  declarator: ESTree.VariableDeclarator,
): boolean {
  return (
    declarator.parent.type === "VariableDeclaration" &&
    declarator.parent.kind !== "var" &&
    variable.references.every((reference) => reference.init || !reference.isWrite())
  );
}
