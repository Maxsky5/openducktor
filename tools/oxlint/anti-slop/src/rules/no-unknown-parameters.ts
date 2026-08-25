import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

import {
  createTypeEnvironment,
  typeResolvesToAny,
  typeResolvesToUnknown,
} from "../shared/dictionary-types.ts";
import { unwrapTransparentExpression } from "../shared/transparent-expression.ts";

type RuntimeFunction = ESTree.ArrowFunctionExpression | ESTree.Function;

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

function directlyExposesParameter(expression: ESTree.Expression, parameterName: string): boolean {
  const unwrapped = unwrapTransparentExpression(expression, { includeTypeAssertions: true });
  if (unwrapped !== expression) return directlyExposesParameter(unwrapped, parameterName);
  if (expression.type === "Identifier") return expression.name === parameterName;
  if (expression.type === "ChainExpression")
    return directlyExposesParameter(expression.expression, parameterName);
  if (expression.type === "ArrowFunctionExpression" || expression.type === "FunctionExpression") {
    if (
      expression.params.some((parameter) => parameterNameOfBinding(parameter) === parameterName)
    ) {
      return false;
    }
    if (expression.body === null) return false;
    return expression.body.type === "BlockStatement"
      ? expression.body.body.some((statement) =>
          statementReturnsParameter(statement, parameterName),
        )
      : directlyExposesParameter(expression.body, parameterName);
  }
  if (expression.type === "AwaitExpression") {
    return directlyExposesParameter(expression.argument, parameterName);
  }
  if (expression.type === "ConditionalExpression") {
    return (
      directlyExposesParameter(expression.consequent, parameterName) ||
      directlyExposesParameter(expression.alternate, parameterName)
    );
  }
  if (expression.type === "LogicalExpression") {
    return (
      directlyExposesParameter(expression.left, parameterName) ||
      directlyExposesParameter(expression.right, parameterName)
    );
  }
  if (expression.type === "SequenceExpression") {
    const lastExpression = expression.expressions.at(-1);
    return lastExpression !== undefined && directlyExposesParameter(lastExpression, parameterName);
  }
  if (expression.type === "MemberExpression" && expression.object.type !== "Super") {
    return directlyExposesParameter(expression.object, parameterName);
  }
  if (expression.type === "ArrayExpression") {
    return expression.elements.some(
      (element) =>
        element !== null &&
        directlyExposesParameter(
          element.type === "SpreadElement" ? element.argument : element,
          parameterName,
        ),
    );
  }
  if (expression.type === "ObjectExpression") {
    return expression.properties.some((property) =>
      directlyExposesParameter(
        property.type === "SpreadElement" ? property.argument : property.value,
        parameterName,
      ),
    );
  }
  if (expression.type === "TemplateLiteral") {
    return expression.expressions.some((part) => directlyExposesParameter(part, parameterName));
  }
  return false;
}

function parameterNameOfBinding(parameter: Parameter): string | null {
  if (parameter.type === "TSParameterProperty") return parameterNameOfBinding(parameter.parameter);
  if (parameter.type === "AssignmentPattern") return parameterNameOfBinding(parameter.left);
  if (parameter.type === "RestElement") return parameterNameOfBinding(parameter.argument);
  return parameter.type === "Identifier" ? parameter.name : null;
}

function statementReturnsParameter(statement: ESTree.Statement, parameterName: string): boolean {
  if (statement.type === "ReturnStatement") {
    return (
      statement.argument !== null && directlyExposesParameter(statement.argument, parameterName)
    );
  }
  if (statement.type === "BlockStatement") {
    return statement.body.some((child) => statementReturnsParameter(child, parameterName));
  }
  if (statement.type === "IfStatement") {
    return (
      statementReturnsParameter(statement.consequent, parameterName) ||
      (statement.alternate !== null &&
        statementReturnsParameter(statement.alternate, parameterName))
    );
  }
  if (statement.type === "SwitchStatement") {
    return statement.cases.some((case_) =>
      case_.consequent.some((child) => statementReturnsParameter(child, parameterName)),
    );
  }
  if (statement.type === "TryStatement") {
    return (
      statementReturnsParameter(statement.block, parameterName) ||
      (statement.handler !== null &&
        statementReturnsParameter(statement.handler.body, parameterName)) ||
      (statement.finalizer !== null &&
        statementReturnsParameter(statement.finalizer, parameterName))
    );
  }
  return false;
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

    const report = (functionNode: RuntimeFunction, name: string): void => {
      const parameter =
        functionNode.params.find((candidate) => {
          const annotation = parameterAnnotation(candidate);
          return (
            annotation?.typeAnnotation.type === "TSUnknownKeyword" &&
            parameterName(candidate, context.sourceCode.getText(candidate)) === name
          );
        }) ?? null;
      const annotation = parameter === null ? null : parameterAnnotation(parameter);
      if (annotation === null || annotation === undefined || reportedParameters.has(annotation)) {
        return;
      }
      reportedParameters.add(annotation);
      context.report({
        node: annotation.typeAnnotation,
        messageId: "unknownParameter",
        data: { parameter: name },
      });
    };

    const checkAssertion = (node: ESTree.TSAsExpression | ESTree.TSTypeAssertion): void => {
      const functionNode = enclosingRuntimeFunction(node);
      if (functionNode === null) return;
      for (const parameter of functionNode.params) {
        const annotation = parameterAnnotation(parameter);
        if (annotation?.typeAnnotation.type !== "TSUnknownKeyword") continue;
        const name = parameterName(parameter, context.sourceCode.getText(parameter));
        if (directlyExposesParameter(node.expression, name)) report(functionNode, name);
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
          if (annotation?.typeAnnotation.type !== "TSUnknownKeyword") continue;
          const name = parameterName(parameter, context.sourceCode.getText(parameter));
          if (directlyExposesParameter(node.body, name)) report(node, name);
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
          if (annotation?.typeAnnotation.type !== "TSUnknownKeyword") continue;
          const name = parameterName(parameter, context.sourceCode.getText(parameter));
          if (directlyExposesParameter(node.argument, name)) report(functionNode, name);
        }
      },
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
