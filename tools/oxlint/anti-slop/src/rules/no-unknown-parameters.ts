import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";

import { resolveVariable, singleVariableDeclarator } from "../shared/global-reference.ts";
import { unwrapTransparentExpression } from "../shared/transparent-expression.ts";

type RuntimeFunction = ESTree.ArrowFunctionExpression | ESTree.Function;
type Parameter = ESTree.ParamPattern;

function parameterAnnotation(parameter: Parameter): ESTree.TSTypeAnnotation | null | undefined {
  if (parameter.type === "TSParameterProperty") return parameterAnnotation(parameter.parameter);
  if (parameter.type === "RestElement") {
    return parameter.typeAnnotation ?? parameterAnnotation(parameter.argument);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameter.typeAnnotation ?? parameter.left.typeAnnotation;
  }
  return parameter.typeAnnotation;
}

function parameterName(parameter: Parameter, sourceText: string): string {
  if (parameter.type === "TSParameterProperty")
    return parameterName(parameter.parameter, sourceText);
  if (parameter.type === "AssignmentPattern") return parameterName(parameter.left, sourceText);
  if (parameter.type === "RestElement") return parameterName(parameter.argument, sourceText);
  return parameter.type === "Identifier"
    ? parameter.name
    : (sourceText.split(":", 1)[0]?.trim() ?? sourceText);
}

function unwrapType(type: ESTree.TSType): ESTree.TSType {
  let current = type;
  while (current.type === "TSParenthesizedType") current = current.typeAnnotation;
  return current;
}

function directlyContainsUnknown(type: ESTree.TSType): boolean {
  const unwrapped = unwrapType(type);
  if (unwrapped.type === "TSUnknownKeyword") return true;
  if (unwrapped.type === "TSUnionType" || unwrapped.type === "TSIntersectionType") {
    return unwrapped.types.some(directlyContainsUnknown);
  }
  if (unwrapped.type === "TSArrayType") return directlyContainsUnknown(unwrapped.elementType);
  return false;
}

function bindingIdentifiers(
  pattern: Parameter | ESTree.BindingPattern,
): readonly ESTree.BindingIdentifier[] {
  if (pattern.type === "TSParameterProperty") return bindingIdentifiers(pattern.parameter);
  if (pattern.type === "AssignmentPattern") return bindingIdentifiers(pattern.left);
  if (pattern.type === "RestElement") return bindingIdentifiers(pattern.argument);
  if (pattern.type === "Identifier") return [pattern];
  if (pattern.type === "ObjectPattern") {
    return pattern.properties.flatMap((property) =>
      bindingIdentifiers(property.type === "RestElement" ? property.argument : property.value),
    );
  }
  return pattern.elements.flatMap((element) =>
    element === null ? [] : bindingIdentifiers(element),
  );
}

function unknownParameterVariables(
  sourceCode: SourceCode,
  parameter: Parameter,
): readonly Variable[] {
  const annotation = parameterAnnotation(parameter);
  if (
    annotation === null ||
    annotation === undefined ||
    !directlyContainsUnknown(annotation.typeAnnotation)
  ) {
    return [];
  }
  return bindingIdentifiers(parameter).flatMap((identifier) => {
    const variable = resolveVariable(sourceCode, identifier);
    return variable === null ? [] : [variable];
  });
}

function enclosingRuntimeFunction(node: ESTree.Node): RuntimeFunction | null {
  let current = node.parent;
  while (current !== null && current.type !== "Program") {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionDeclaration" ||
      current.type === "FunctionExpression"
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function hasKnownReturnType(node: RuntimeFunction): boolean {
  const returnType = node.returnType?.typeAnnotation;
  if (returnType === undefined || returnType.type === "TSAnyKeyword") return false;
  const unwrapped = unwrapType(returnType);
  return (
    unwrapped.type !== "TSUnknownKeyword" &&
    (unwrapped.type !== "TSUnionType" ||
      !unwrapped.types.some(
        (member) =>
          unwrapType(member).type === "TSUnknownKeyword" ||
          unwrapType(member).type === "TSAnyKeyword",
      ))
  );
}

function exposesVariable(
  expression: ESTree.Expression,
  variables: ReadonlySet<Variable>,
  sourceCode: SourceCode,
  visited: ReadonlySet<Variable> = new Set(),
): boolean {
  const unwrapped = unwrapTransparentExpression(expression, { includeTypeAssertions: true });
  if (unwrapped.type === "Identifier") {
    const variable = resolveVariable(sourceCode, unwrapped);
    if (variable === null) return false;
    if (variables.has(variable)) return true;
    if (visited.has(variable)) return false;
    const declaration = singleVariableDeclarator(variable);
    if (declaration?.init === null || declaration?.init === undefined) return false;
    const nextVisited = new Set(visited);
    nextVisited.add(variable);
    return exposesVariable(declaration.init, variables, sourceCode, nextVisited);
  }
  if (unwrapped.type === "MemberExpression" && unwrapped.object.type !== "Super") {
    return exposesVariable(unwrapped.object, variables, sourceCode, visited);
  }
  if (unwrapped.type === "AwaitExpression") {
    return exposesVariable(unwrapped.argument, variables, sourceCode, visited);
  }
  if (unwrapped.type === "ConditionalExpression") {
    return (
      exposesVariable(unwrapped.consequent, variables, sourceCode, visited) ||
      exposesVariable(unwrapped.alternate, variables, sourceCode, visited)
    );
  }
  if (unwrapped.type === "LogicalExpression") {
    return (
      exposesVariable(unwrapped.left, variables, sourceCode, visited) ||
      exposesVariable(unwrapped.right, variables, sourceCode, visited)
    );
  }
  if (unwrapped.type === "SequenceExpression") {
    const result = unwrapped.expressions.at(-1);
    return result !== undefined && exposesVariable(result, variables, sourceCode, visited);
  }
  if (unwrapped.type === "ArrayExpression") {
    return unwrapped.elements.some(
      (element) =>
        element !== null &&
        exposesVariable(
          element.type === "SpreadElement" ? element.argument : element,
          variables,
          sourceCode,
          visited,
        ),
    );
  }
  if (unwrapped.type === "ObjectExpression") {
    return unwrapped.properties.some((property) =>
      exposesVariable(
        property.type === "SpreadElement" ? property.argument : property.value,
        variables,
        sourceCode,
        visited,
      ),
    );
  }
  if (unwrapped.type === "TemplateLiteral") {
    return unwrapped.expressions.some((part) =>
      exposesVariable(part, variables, sourceCode, visited),
    );
  }
  return false;
}

/** Reject explicitly unknown parameters only when a function leaks them as unchecked output. */
export const noUnknownParametersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow returning or asserting explicitly unknown function inputs without a checked output contract.",
    },
    messages: {
      unknownParameter:
        "Parameter `{{parameter}}` is exposed without a checked output contract. Narrow it under an explicit return type or pass it to the boundary parser that owns the input contract.",
    },
  },
  createOnce(context) {
    const reported = new WeakSet<ESTree.TSTypeAnnotation>();

    const reportIfExposed = (node: RuntimeFunction, expression: ESTree.Expression): void => {
      const entries = node.params.flatMap((parameter) => {
        const annotation = parameterAnnotation(parameter);
        if (annotation === null || annotation === undefined) return [];
        return [
          {
            annotation,
            parameter,
            variables: unknownParameterVariables(context.sourceCode, parameter),
          },
        ];
      });

      for (const entry of entries) {
        if (
          entry.variables.length === 0 ||
          reported.has(entry.annotation) ||
          !exposesVariable(expression, new Set(entry.variables), context.sourceCode)
        ) {
          continue;
        }
        reported.add(entry.annotation);
        context.report({
          node: entry.annotation.typeAnnotation,
          messageId: "unknownParameter",
          data: {
            parameter: parameterName(entry.parameter, context.sourceCode.getText(entry.parameter)),
          },
        });
      }
    };

    const checkAssertion = (node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): void => {
      const owner = enclosingRuntimeFunction(node);
      if (owner !== null) reportIfExposed(owner, node.expression);
    };

    return {
      ArrowFunctionExpression(node) {
        if (node.body.type !== "BlockStatement" && !hasKnownReturnType(node)) {
          reportIfExposed(node, node.body);
        }
      },
      ReturnStatement(node) {
        if (node.argument === null) return;
        const owner = enclosingRuntimeFunction(node);
        if (owner !== null && !hasKnownReturnType(owner)) {
          reportIfExposed(owner, node.argument);
        }
      },
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
