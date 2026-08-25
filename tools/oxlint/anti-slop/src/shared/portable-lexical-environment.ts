import type { ESTree } from "@oxlint/plugins";

import { lexicalStructuralTypeParameterNames } from "./lexical-type-parameters.ts";
import { extendPortableTypeEnvironment } from "./portable-type-declarations.ts";
import type { PortableTypeEnvironment } from "./portable-type-model.ts";
import {
  bindingPatternValueBindings,
  emptyTypeEnvironment,
  withoutVisibleTypeName,
  withVisibleValueBindings,
} from "./portable-value-bindings.ts";

function scopeStatements(node: ESTree.Node): readonly ESTree.Statement[] | null {
  if (
    node.type === "Program" ||
    node.type === "BlockStatement" ||
    node.type === "StaticBlock" ||
    node.type === "TSModuleBlock"
  ) {
    return node.body;
  }
  return node.type === "SwitchStatement" ? node.cases.flatMap((case_) => case_.consequent) : null;
}

/** Build the visible TypeScript type and value declarations at one AST node. */
export function createTypeEnvironment(
  node: ESTree.Node,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): PortableTypeEnvironment {
  let visible = emptyTypeEnvironment(visitorKeys);
  const ancestry: ESTree.Node[] = [];
  let current: ESTree.Node | null = node;
  while (current !== null) {
    ancestry.push(current);
    current = current.parent;
  }

  for (const ancestor of ancestry.reverse()) {
    const statements = scopeStatements(ancestor);
    if (statements !== null) visible = extendPortableTypeEnvironment(visible, statements);
    if (
      ancestor.type === "ArrowFunctionExpression" ||
      ancestor.type === "FunctionDeclaration" ||
      ancestor.type === "FunctionExpression"
    ) {
      visible = withVisibleValueBindings(
        visible,
        ancestor.params.flatMap((parameter) =>
          bindingPatternValueBindings(
            parameter.type === "TSParameterProperty" ? parameter.parameter : parameter,
          ),
        ),
      );
    } else if (ancestor.type === "CatchClause" && ancestor.param !== null) {
      visible = withVisibleValueBindings(visible, bindingPatternValueBindings(ancestor.param));
    }
    if ("typeParameters" in ancestor) {
      for (const parameter of ancestor.typeParameters?.params ?? []) {
        visible = withoutVisibleTypeName(visible, parameter.name.name);
      }
    }
  }

  for (const name of lexicalStructuralTypeParameterNames(node, visitorKeys)) {
    visible = withoutVisibleTypeName(visible, name);
  }
  return visible;
}
