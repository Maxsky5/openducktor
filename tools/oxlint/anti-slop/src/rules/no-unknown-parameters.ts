import { defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

type Parameter = ESTree.ParamPattern;
type ParameterOwner =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

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

function isRuntimeFunction(node: ParameterOwner): node is ESTree.ArrowFunctionExpression | ESTree.Function {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression"
  );
}

function calleeName(callee: ESTree.Expression | ESTree.Super): string | null {
  if (callee.type === "Identifier") return callee.name;
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name;
  }
  return null;
}

function directlyReceivesParameter(
  expression: ESTree.CallExpression,
  parameterName: string,
): boolean {
  return expression.arguments.some(
    (argument) => argument.type === "Identifier" && argument.name === parameterName,
  );
}

function isParserCall(
  expression: ESTree.Expression,
  parameterName: string,
  allowNamedParser: boolean,
): boolean {
  if (expression.type === "ParenthesizedExpression") {
    return isParserCall(expression.expression, parameterName, allowNamedParser);
  }
  if (expression.type === "MemberExpression" && expression.object.type !== "Super") {
    return isParserCall(expression.object, parameterName, allowNamedParser);
  }
  if (expression.type === "AwaitExpression") {
    return isParserCall(expression.argument, parameterName, allowNamedParser);
  }
  if (expression.type === "LogicalExpression") {
    return (
      isParserCall(expression.left, parameterName, allowNamedParser) ||
      isParserCall(expression.right, parameterName, allowNamedParser)
    );
  }
  if (expression.type === "ConditionalExpression") {
    return (
      isNarrowingExpression(expression.test, parameterName) ||
      isParserCall(expression.consequent, parameterName, allowNamedParser) ||
      isParserCall(expression.alternate, parameterName, allowNamedParser)
    );
  }
  if (expression.type !== "CallExpression") {
    return false;
  }
  const name = calleeName(expression.callee);
  const isParser =
    name === "parse" ||
    name === "safeParse" ||
    (allowNamedParser &&
      name !== "parseInt" &&
      name !== "parseFloat" &&
      /^(?:as|assert|decode|parse|require|validate)[A-Z_]/u.test(name ?? ""));
  if (isParser && directlyReceivesParameter(expression, parameterName)) {
    return true;
  }
  return expression.arguments.some(
    (argument) =>
      argument.type !== "SpreadElement" &&
      isParserCall(argument, parameterName, allowNamedParser),
  );
}

function isNarrowingExpression(expression: ESTree.Expression, parameterName: string): boolean {
  if (expression.type === "ParenthesizedExpression") {
    return isNarrowingExpression(expression.expression, parameterName);
  }
  if (expression.type === "UnaryExpression") {
    return isNarrowingExpression(expression.argument, parameterName);
  }
  if (expression.type === "LogicalExpression") {
    return (
      isNarrowingExpression(expression.left, parameterName) ||
      isNarrowingExpression(expression.right, parameterName)
    );
  }
  if (expression.type === "BinaryExpression") {
    const referencesParameter =
      (expression.left.type === "Identifier" && expression.left.name === parameterName) ||
      (expression.right.type === "Identifier" && expression.right.name === parameterName);
    const readsParameterType =
      (expression.left.type === "UnaryExpression" &&
        expression.left.operator === "typeof" &&
        expression.left.argument.type === "Identifier" &&
        expression.left.argument.name === parameterName) ||
      (expression.right.type === "UnaryExpression" &&
        expression.right.operator === "typeof" &&
        expression.right.argument.type === "Identifier" &&
        expression.right.argument.name === parameterName);
    return referencesParameter || readsParameterType;
  }
  if (expression.type !== "CallExpression") return false;
  const name = calleeName(expression.callee);
  const isGuard =
    name === "isArray" || /^(?:has|is)[A-Z_]/u.test(name ?? "");
  return isGuard && directlyReceivesParameter(expression, parameterName);
}

function statementValidatesParameter(
  statement: ESTree.Statement,
  parameterName: string,
  hasOutputContract: boolean,
): boolean {
  if (statement.type === "IfStatement") {
    return isNarrowingExpression(statement.test, parameterName);
  }
  if (statement.type === "ExpressionStatement") {
    if (!hasOutputContract || statement.expression.type !== "CallExpression") return false;
    const name = calleeName(statement.expression.callee);
    return (
      /^(?:assert|require)[A-Z_]/u.test(name ?? "") &&
      directlyReceivesParameter(statement.expression, parameterName)
    );
  }
  if (statement.type === "ReturnStatement") {
    return (
      statement.argument !== null &&
      (isParserCall(statement.argument, parameterName, hasOutputContract) ||
        isNarrowingExpression(statement.argument, parameterName))
    );
  }
  if (statement.type === "VariableDeclaration") {
    return (
      hasOutputContract &&
      statement.declarations.some(
        (declaration) =>
          declaration.init !== null &&
          (isParserCall(declaration.init, parameterName, true) ||
            isNarrowingExpression(declaration.init, parameterName)),
      )
    );
  }
  return false;
}

function bodyValidatesParameter(
  body: ESTree.BlockStatement | ESTree.Expression,
  parameterName: string,
  hasOutputContract: boolean,
): boolean {
  if (body.type !== "BlockStatement") {
    return (
      isParserCall(body, parameterName, hasOutputContract) ||
      isNarrowingExpression(body, parameterName)
    );
  }
  return body.body.some((statement) =>
    statementValidatesParameter(statement, parameterName, hasOutputContract),
  );
}

function isValidatedUnknownParameter(node: ParameterOwner, name: string): boolean {
  if (node.returnType?.typeAnnotation.type === "TSTypePredicate") return true;
  if (!isRuntimeFunction(node)) return false;
  return bodyValidatesParameter(node.body, name, node.returnType != null);
}

/** Disallow unknown inputs except explicitly named error-cause enrichment. */
export const noUnknownParametersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow explicitly unknown function parameters except `cause`; decode unknown input at its I/O boundary instead.",
    },
    messages: {
      unknownParameter:
        "Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.",
    },
  },
  createOnce(context) {
    const checkParameters = (node: ParameterOwner) => {
      for (const parameter of node.params) {
        const annotation = parameterAnnotation(parameter);
        if (!annotation) continue;
        const annotationText = context.sourceCode.getText(annotation.typeAnnotation);
        const exposesUnknown = annotation.typeAnnotation.type === "TSUnknownKeyword";
        const hidesSchemaInput =
          /^Parameters\s*<\s*typeof\s+.+\.(?:parse|safeParse)\s*>\s*\[\s*0\s*\]$/u.test(
            annotationText,
          );
        if (!exposesUnknown && !hidesSchemaInput) continue;
        const name = parameterName(parameter, context.sourceCode.getText(parameter));
        if (name === "cause" || isValidatedUnknownParameter(node, name)) continue;
        context.report({
          node: annotation.typeAnnotation,
          messageId: "unknownParameter",
          data: { parameter: name },
        });
      }
    };

    return {
      ArrowFunctionExpression: checkParameters,
      FunctionDeclaration: checkParameters,
      FunctionExpression: checkParameters,
      TSCallSignatureDeclaration: checkParameters,
      TSConstructSignatureDeclaration: checkParameters,
      TSConstructorType: checkParameters,
      TSDeclareFunction: checkParameters,
      TSEmptyBodyFunctionExpression: checkParameters,
      TSFunctionType: checkParameters,
      TSMethodSignature: checkParameters,
    };
  },
});
