import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";

import {
  createTypeEnvironment,
  typeResolvesToAny,
  typeResolvesToUnknown,
} from "../shared/dictionary-types.ts";
import { unwrapTransparentExpression } from "../shared/transparent-expression.ts";
import { resolveVariable } from "../shared/global-reference.ts";
import { isStableBinding } from "../shared/stable-binding.ts";

type RuntimeFunction = ESTree.ArrowFunctionExpression | ESTree.Function;
type StableAlias = {
  readonly expression: ESTree.Expression;
  readonly variable: Variable;
};

type Parameter = ESTree.ParamPattern;

function parameterAnnotation(parameter: Parameter): ESTree.TSTypeAnnotation | null | undefined {
  if (parameter.type === "TSParameterProperty") {
    return parameterAnnotation(parameter.parameter);
  }
  if (parameter.type === "RestElement") {
    return parameter.typeAnnotation ?? parameterAnnotation(parameter.argument);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameter.typeAnnotation ?? parameter.left.typeAnnotation;
  }
  return parameter.typeAnnotation;
}

function parameterName(parameter: Parameter, sourceText: string): string {
  if (parameter.type === "TSParameterProperty") {
    return parameterName(parameter.parameter, sourceText);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameterName(parameter.left, sourceText);
  }
  if (parameter.type === "RestElement") {
    return parameterName(parameter.argument, sourceText);
  }
  return parameter.type === "Identifier"
    ? parameter.name
    : sourceText.replace(/\s*:\s*unknown\s*$/u, "");
}

function parameterIdentifier(parameter: Parameter): ESTree.BindingIdentifier | null {
  if (parameter.type === "TSParameterProperty") return parameterIdentifier(parameter.parameter);
  if (parameter.type === "AssignmentPattern") return parameterIdentifier(parameter.left);
  if (parameter.type === "RestElement") return parameterIdentifier(parameter.argument);
  return parameter.type === "Identifier" ? parameter : null;
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

function stableAliasInitializer(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
  resolvingAliases: ReadonlySet<Variable>,
): StableAlias | null {
  const variable = resolveVariable(sourceCode, identifier);
  if (variable === null || resolvingAliases.has(variable) || variable.defs.length !== 1)
    return null;
  const definition = variable.defs[0];
  if (
    definition?.type !== "Variable" ||
    definition.node.type !== "VariableDeclarator" ||
    definition.node.id.type !== "Identifier" ||
    definition.node.init === null ||
    !isStableBinding(variable, definition.node)
  ) {
    return null;
  }
  return { expression: definition.node.init, variable };
}

function directlyExposesParameter(
  expression: ESTree.Expression,
  parameterVariable: Variable,
  sourceCode: SourceCode,
  resolvingAliases: ReadonlySet<Variable> = new Set(),
): boolean {
  const unwrapped = unwrapTransparentExpression(expression, { includeTypeAssertions: true });
  if (unwrapped !== expression) {
    return directlyExposesParameter(unwrapped, parameterVariable, sourceCode, resolvingAliases);
  }
  if (expression.type === "Identifier") {
    if (resolveVariable(sourceCode, expression) === parameterVariable) return true;
    const alias = stableAliasInitializer(sourceCode, expression, resolvingAliases);
    if (alias === null) return false;
    const nextResolving = new Set(resolvingAliases);
    nextResolving.add(alias.variable);
    return directlyExposesParameter(alias.expression, parameterVariable, sourceCode, nextResolving);
  }
  if (expression.type === "ChainExpression")
    return directlyExposesParameter(
      expression.expression,
      parameterVariable,
      sourceCode,
      resolvingAliases,
    );
  if (expression.type === "ArrowFunctionExpression" || expression.type === "FunctionExpression") {
    if (expression.body === null) return false;
    return expression.body.type === "BlockStatement"
      ? expression.body.body.some((statement) =>
          statementReturnsParameter(statement, parameterVariable, sourceCode),
        )
      : directlyExposesParameter(expression.body, parameterVariable, sourceCode, resolvingAliases);
  }
  if (expression.type === "AwaitExpression") {
    return directlyExposesParameter(
      expression.argument,
      parameterVariable,
      sourceCode,
      resolvingAliases,
    );
  }
  if (expression.type === "ConditionalExpression") {
    return (
      directlyExposesParameter(
        expression.consequent,
        parameterVariable,
        sourceCode,
        resolvingAliases,
      ) ||
      directlyExposesParameter(
        expression.alternate,
        parameterVariable,
        sourceCode,
        resolvingAliases,
      )
    );
  }
  if (expression.type === "LogicalExpression") {
    return (
      directlyExposesParameter(expression.left, parameterVariable, sourceCode, resolvingAliases) ||
      directlyExposesParameter(expression.right, parameterVariable, sourceCode, resolvingAliases)
    );
  }
  if (expression.type === "SequenceExpression") {
    const lastExpression = expression.expressions.at(-1);
    return (
      lastExpression !== undefined &&
      directlyExposesParameter(lastExpression, parameterVariable, sourceCode, resolvingAliases)
    );
  }
  if (expression.type === "MemberExpression" && expression.object.type !== "Super") {
    return directlyExposesParameter(
      expression.object,
      parameterVariable,
      sourceCode,
      resolvingAliases,
    );
  }
  if (expression.type === "ArrayExpression") {
    return expression.elements.some(
      (element) =>
        element !== null &&
        directlyExposesParameter(
          element.type === "SpreadElement" ? element.argument : element,
          parameterVariable,
          sourceCode,
          resolvingAliases,
        ),
    );
  }
  if (expression.type === "ObjectExpression") {
    return expression.properties.some((property) =>
      directlyExposesParameter(
        property.type === "SpreadElement" ? property.argument : property.value,
        parameterVariable,
        sourceCode,
        resolvingAliases,
      ),
    );
  }
  if (expression.type === "TemplateLiteral") {
    return expression.expressions.some((part) =>
      directlyExposesParameter(part, parameterVariable, sourceCode, resolvingAliases),
    );
  }
  return false;
}

function statementReturnsParameter(
  statement: ESTree.Statement,
  parameterVariable: Variable,
  sourceCode: SourceCode,
): boolean {
  if (statement.type === "ReturnStatement") {
    return (
      statement.argument !== null &&
      directlyExposesParameter(statement.argument, parameterVariable, sourceCode)
    );
  }
  if (statement.type === "BlockStatement") {
    return statement.body.some((child) =>
      statementReturnsParameter(child, parameterVariable, sourceCode),
    );
  }
  if (statement.type === "IfStatement") {
    return (
      statementReturnsParameter(statement.consequent, parameterVariable, sourceCode) ||
      (statement.alternate !== null &&
        statementReturnsParameter(statement.alternate, parameterVariable, sourceCode))
    );
  }
  if (statement.type === "SwitchStatement") {
    return statement.cases.some((case_) =>
      case_.consequent.some((child) =>
        statementReturnsParameter(child, parameterVariable, sourceCode),
      ),
    );
  }
  if (statement.type === "TryStatement") {
    return (
      statementReturnsParameter(statement.block, parameterVariable, sourceCode) ||
      (statement.handler !== null &&
        statementReturnsParameter(statement.handler.body, parameterVariable, sourceCode)) ||
      (statement.finalizer !== null &&
        statementReturnsParameter(statement.finalizer, parameterVariable, sourceCode))
    );
  }
  return false;
}

function parameterTypeResolvesToUnknown(
  annotation: ESTree.TSTypeAnnotation | null | undefined,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): boolean {
  if (annotation === null || annotation === undefined) return false;
  const environment = createTypeEnvironment(annotation.typeAnnotation, visitorKeys);
  return typeResolvesToUnknown(annotation.typeAnnotation, environment);
}

function hasKnownOutputContract(
  functionNode: RuntimeFunction,
  visitorKeys: Readonly<Record<string, readonly string[]>>,
): boolean {
  const returnType = functionNode.returnType?.typeAnnotation;
  if (returnType === undefined) return false;
  const environment = createTypeEnvironment(returnType, visitorKeys);
  return (
    !typeResolvesToAny(returnType, environment) && !typeResolvesToUnknown(returnType, environment)
  );
}

/** Reject direct exposure and assertion of explicitly unknown runtime inputs. */
export const noUnknownParametersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow inferred returns and type assertions that directly expose an explicitly unknown parameter.",
    },
    messages: {
      unknownParameter:
        "Parameter `{{parameter}}` is exposed without a checked output contract. Narrow it under an explicit return type or pass it to the boundary parser that owns the input contract.",
    },
  },
  createOnce(context) {
    const reportedParameters = new WeakSet<ESTree.TSTypeAnnotation>();

    const report = (parameter: Parameter): void => {
      const annotation = parameterAnnotation(parameter);
      if (annotation === null || annotation === undefined || reportedParameters.has(annotation)) {
        return;
      }
      reportedParameters.add(annotation);
      context.report({
        node: annotation.typeAnnotation,
        messageId: "unknownParameter",
        data: { parameter: parameterName(parameter, context.sourceCode.getText(parameter)) },
      });
    };

    const resolvedParameter = (parameter: Parameter): Variable | null => {
      const identifier = parameterIdentifier(parameter);
      return identifier === null ? null : resolveVariable(context.sourceCode, identifier);
    };

    const checkAssertion = (node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): void => {
      const functionNode = enclosingRuntimeFunction(node);
      if (functionNode === null) return;
      for (const parameter of functionNode.params) {
        const annotation = parameterAnnotation(parameter);
        if (!parameterTypeResolvesToUnknown(annotation, context.sourceCode.visitorKeys)) continue;
        const variable = resolvedParameter(parameter);
        if (
          variable !== null &&
          directlyExposesParameter(node.expression, variable, context.sourceCode)
        ) {
          report(parameter);
        }
      }
    };

    return {
      ArrowFunctionExpression(node) {
        if (
          node.body.type === "BlockStatement" ||
          hasKnownOutputContract(node, context.sourceCode.visitorKeys)
        ) {
          return;
        }
        for (const parameter of node.params) {
          const annotation = parameterAnnotation(parameter);
          if (!parameterTypeResolvesToUnknown(annotation, context.sourceCode.visitorKeys)) continue;
          const variable = resolvedParameter(parameter);
          if (
            variable !== null &&
            directlyExposesParameter(node.body, variable, context.sourceCode)
          ) {
            report(parameter);
          }
        }
      },
      ReturnStatement(node) {
        if (node.argument === null) return;
        const functionNode = enclosingRuntimeFunction(node);
        if (
          functionNode === null ||
          hasKnownOutputContract(functionNode, context.sourceCode.visitorKeys)
        ) {
          return;
        }
        for (const parameter of functionNode.params) {
          const annotation = parameterAnnotation(parameter);
          if (!parameterTypeResolvesToUnknown(annotation, context.sourceCode.visitorKeys)) continue;
          const variable = resolvedParameter(parameter);
          if (
            variable !== null &&
            directlyExposesParameter(node.argument, variable, context.sourceCode)
          ) {
            report(parameter);
          }
        }
      },
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
