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

function isRuntimeFunction(
  node: ParameterOwner,
): node is ESTree.ArrowFunctionExpression | ESTree.Function {
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
      argument.type !== "SpreadElement" && isParserCall(argument, parameterName, allowNamedParser),
  );
}

const equalityOperators: ReadonlySet<string> = new Set(["==", "!=", "===", "!=="]);

function isParameterIdentifier(expression: ESTree.Expression, parameterName: string): boolean {
  return expression.type === "Identifier" && expression.name === parameterName;
}

function isTypeofParameter(expression: ESTree.Expression, parameterName: string): boolean {
  return (
    expression.type === "UnaryExpression" &&
    expression.operator === "typeof" &&
    isParameterIdentifier(expression.argument, parameterName)
  );
}

function isTypeofResultLiteral(expression: ESTree.Expression): boolean {
  if (expression.type !== "Literal") return false;
  return (
    expression.value === "bigint" ||
    expression.value === "boolean" ||
    expression.value === "function" ||
    expression.value === "number" ||
    expression.value === "object" ||
    expression.value === "string" ||
    expression.value === "symbol" ||
    expression.value === "undefined"
  );
}

function isBinaryNarrowingExpression(
  expression: ESTree.BinaryExpression | ESTree.PrivateInExpression,
  parameterName: string,
): boolean {
  if (expression.left.type === "PrivateIdentifier") return false;
  if (expression.operator === "instanceof") {
    return isParameterIdentifier(expression.left, parameterName);
  }
  if (!equalityOperators.has(expression.operator)) return false;
  const comparesTypeof =
    (isTypeofParameter(expression.left, parameterName) &&
      isTypeofResultLiteral(expression.right)) ||
    (isTypeofParameter(expression.right, parameterName) && isTypeofResultLiteral(expression.left));
  return comparesTypeof;
}

function isNarrowingExpression(expression: ESTree.Expression, parameterName: string): boolean {
  if (expression.type === "ParenthesizedExpression") {
    return isNarrowingExpression(expression.expression, parameterName);
  }
  if (expression.type === "UnaryExpression") {
    return expression.operator === "!" && isNarrowingExpression(expression.argument, parameterName);
  }
  if (expression.type === "LogicalExpression") {
    if (expression.operator === "&&") {
      return (
        isNarrowingExpression(expression.left, parameterName) ||
        isNarrowingExpression(expression.right, parameterName)
      );
    }
    return (
      isNarrowingExpression(expression.left, parameterName) &&
      isNarrowingExpression(expression.right, parameterName)
    );
  }
  if (expression.type === "BinaryExpression") {
    return isBinaryNarrowingExpression(expression, parameterName);
  }
  if (expression.type !== "CallExpression") return false;
  const name = calleeName(expression.callee);
  const isGuard = name === "isArray" || /^(?:has|is)[A-Z_]/u.test(name ?? "");
  return isGuard && directlyReceivesParameter(expression, parameterName);
}

function isNegativeNarrowingExpression(
  expression: ESTree.Expression,
  parameterName: string,
): boolean {
  if (expression.type === "ParenthesizedExpression") {
    return isNegativeNarrowingExpression(expression.expression, parameterName);
  }
  if (expression.type === "UnaryExpression" && expression.operator === "!") {
    return isNarrowingExpression(expression.argument, parameterName);
  }
  if (expression.type === "LogicalExpression") {
    if (expression.operator === "&&") return false;
    return (
      isNegativeNarrowingExpression(expression.left, parameterName) ||
      isNegativeNarrowingExpression(expression.right, parameterName)
    );
  }
  if (expression.type !== "BinaryExpression") return false;
  return (
    (expression.operator === "!=" || expression.operator === "!==") &&
    isBinaryNarrowingExpression(expression, parameterName)
  );
}

function expressionReferencesParameter(
  expression: ESTree.Expression,
  parameterName: string,
): boolean {
  if (expression.type === "Identifier") return expression.name === parameterName;
  if (
    expression.type === "ParenthesizedExpression" ||
    expression.type === "TSAsExpression" ||
    expression.type === "TSTypeAssertion" ||
    expression.type === "TSNonNullExpression"
  ) {
    return expressionReferencesParameter(expression.expression, parameterName);
  }
  if (expression.type === "AwaitExpression" || expression.type === "UnaryExpression") {
    return expressionReferencesParameter(expression.argument, parameterName);
  }
  if (expression.type === "BinaryExpression" || expression.type === "LogicalExpression") {
    if (expression.left.type === "PrivateIdentifier") return false;
    return (
      expressionReferencesParameter(expression.left, parameterName) ||
      expressionReferencesParameter(expression.right, parameterName)
    );
  }
  if (expression.type === "ConditionalExpression") {
    return (
      expressionReferencesParameter(expression.test, parameterName) ||
      expressionReferencesParameter(expression.consequent, parameterName) ||
      expressionReferencesParameter(expression.alternate, parameterName)
    );
  }
  if (expression.type === "MemberExpression") {
    return (
      expression.object.type !== "Super" &&
      expressionReferencesParameter(expression.object, parameterName)
    );
  }
  if (expression.type === "CallExpression" || expression.type === "NewExpression") {
    return expression.arguments.some((argument) =>
      argument.type === "SpreadElement"
        ? expressionReferencesParameter(argument.argument, parameterName)
        : expressionReferencesParameter(argument, parameterName),
    );
  }
  if (expression.type === "ArrayExpression") {
    return expression.elements.some(
      (element) =>
        element !== null &&
        (element.type === "SpreadElement"
          ? expressionReferencesParameter(element.argument, parameterName)
          : expressionReferencesParameter(element, parameterName)),
    );
  }
  if (expression.type === "ObjectExpression") {
    return expression.properties.some((property) => {
      if (property.type === "SpreadElement") {
        return expressionReferencesParameter(property.argument, parameterName);
      }
      return expressionReferencesParameter(property.value, parameterName);
    });
  }
  return false;
}

function hasUnparsedParameterReference(
  expression: ESTree.Expression,
  parameterName: string,
  allowNamedParser: boolean,
): boolean {
  if (expression.type === "Identifier") return expression.name === parameterName;
  if (
    expression.type === "ParenthesizedExpression" ||
    expression.type === "TSAsExpression" ||
    expression.type === "TSTypeAssertion" ||
    expression.type === "TSNonNullExpression"
  ) {
    return hasUnparsedParameterReference(expression.expression, parameterName, allowNamedParser);
  }
  if (expression.type === "AwaitExpression") {
    return hasUnparsedParameterReference(expression.argument, parameterName, allowNamedParser);
  }
  if (expression.type === "ConditionalExpression") {
    if (!expressionReferencesParameter(expression.test, parameterName)) {
      return (
        hasUnparsedParameterReference(expression.consequent, parameterName, allowNamedParser) ||
        hasUnparsedParameterReference(expression.alternate, parameterName, allowNamedParser)
      );
    }
    const positiveGuard =
      isNarrowingExpression(expression.test, parameterName) &&
      !isNegativeNarrowingExpression(expression.test, parameterName);
    if (positiveGuard) {
      return expressionReferencesParameter(expression.alternate, parameterName);
    }
    if (isNegativeNarrowingExpression(expression.test, parameterName)) {
      return expressionReferencesParameter(expression.consequent, parameterName);
    }
    return expressionReferencesParameter(expression, parameterName);
  }
  if (expression.type === "MemberExpression" && expression.object.type !== "Super") {
    return hasUnparsedParameterReference(expression.object, parameterName, allowNamedParser);
  }
  if (expression.type !== "CallExpression") {
    return expressionReferencesParameter(expression, parameterName);
  }

  const name = calleeName(expression.callee);
  const isDirectParser =
    (name === "parse" ||
      name === "safeParse" ||
      (allowNamedParser &&
        /^(?:as|assert|decode|parse|require|validate)[A-Z_]/u.test(name ?? ""))) &&
    directlyReceivesParameter(expression, parameterName);
  return expression.arguments.some((argument) => {
    const value = argument.type === "SpreadElement" ? argument.argument : argument;
    if (isDirectParser && value.type === "Identifier" && value.name === parameterName) return false;
    return hasUnparsedParameterReference(value, parameterName, allowNamedParser);
  });
}

function bodyReturnsParameterAfter(
  body: ESTree.BlockStatement,
  statementIndex: number,
  parameterName: string,
): boolean {
  return body.body
    .slice(statementIndex + 1)
    .some(
      (statement) =>
        statement.type === "ReturnStatement" &&
        statement.argument !== null &&
        expressionReferencesParameter(statement.argument, parameterName),
    );
}

function statementAlwaysExits(statement: ESTree.Statement): boolean {
  if (statement.type === "ReturnStatement" || statement.type === "ThrowStatement") return true;
  if (statement.type === "BlockStatement") {
    return statement.body.some(statementAlwaysExits);
  }
  if (statement.type !== "IfStatement" || statement.alternate === null) return false;
  return statementAlwaysExits(statement.consequent) && statementAlwaysExits(statement.alternate);
}

function statementValidatesParameter(
  statement: ESTree.Statement,
  parameterName: string,
  hasOutputContract: boolean,
): boolean {
  if (statement.type === "IfStatement") {
    const rejectsInvalidInput =
      statementAlwaysExits(statement.consequent) &&
      isNegativeNarrowingExpression(statement.test, parameterName);
    const rejectsNonMatchingInput =
      statement.alternate !== null &&
      statementAlwaysExits(statement.alternate) &&
      isNarrowingExpression(statement.test, parameterName);
    return rejectsInvalidInput || rejectsNonMatchingInput;
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
      ((isParserCall(statement.argument, parameterName, hasOutputContract) &&
        !hasUnparsedParameterReference(statement.argument, parameterName, hasOutputContract)) ||
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
  return body.body.some(
    (statement, statementIndex) =>
      statementValidatesParameter(statement, parameterName, hasOutputContract) &&
      !(
        statement.type === "VariableDeclaration" &&
        bodyReturnsParameterAfter(body, statementIndex, parameterName)
      ),
  );
}

function isValidatedUnknownParameter(node: ParameterOwner, name: string): boolean {
  if (!isRuntimeFunction(node)) {
    return node.returnType?.typeAnnotation.type === "TSTypePredicate";
  }
  if (node.body === null) return false;
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
