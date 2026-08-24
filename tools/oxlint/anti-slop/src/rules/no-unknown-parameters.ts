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

function isParserCall(expression: ESTree.Expression, parameterName: string): boolean {
  if (expression.type === "ParenthesizedExpression") {
    return isParserCall(expression.expression, parameterName);
  }
  if (expression.type === "MemberExpression" && expression.object.type !== "Super") {
    return isParserCall(expression.object, parameterName);
  }
  if (expression.type === "AwaitExpression") {
    return isParserCall(expression.argument, parameterName);
  }
  if (expression.type === "LogicalExpression") {
    return (
      isParserCall(expression.left, parameterName) || isParserCall(expression.right, parameterName)
    );
  }
  if (expression.type === "ConditionalExpression") {
    return (
      isNarrowingExpression(expression.test, parameterName) ||
      isParserCall(expression.consequent, parameterName) ||
      isParserCall(expression.alternate, parameterName)
    );
  }
  if (expression.type !== "CallExpression") {
    return false;
  }
  const name = calleeName(expression.callee);
  const isParser = name === "parse" || name === "safeParse";
  if (isParser && directlyReceivesParameter(expression, parameterName)) {
    return true;
  }
  return expression.arguments.some(
    (argument) => argument.type !== "SpreadElement" && isParserCall(argument, parameterName),
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

function isNullishExpression(expression: ESTree.Expression): boolean {
  return (
    (expression.type === "Literal" && expression.value === null) ||
    (expression.type === "Identifier" && expression.name === "undefined")
  );
}

function binaryNarrowingPolarity(
  expression: ESTree.BinaryExpression | ESTree.PrivateInExpression,
  parameterName: string,
): "false" | "true" | null {
  if (expression.left.type === "PrivateIdentifier") return null;
  if (expression.operator === "instanceof") {
    return isParameterIdentifier(expression.left, parameterName) ? "true" : null;
  }
  if (!equalityOperators.has(expression.operator)) return null;
  const comparesNullish =
    (isParameterIdentifier(expression.left, parameterName) &&
      isNullishExpression(expression.right)) ||
    (isParameterIdentifier(expression.right, parameterName) &&
      isNullishExpression(expression.left));
  if (comparesNullish) {
    return expression.operator === "!=" || expression.operator === "!==" ? "false" : "true";
  }
  const comparesTypeof =
    (isTypeofParameter(expression.left, parameterName) &&
      isTypeofResultLiteral(expression.right)) ||
    (isTypeofParameter(expression.right, parameterName) && isTypeofResultLiteral(expression.left));
  if (!comparesTypeof) return null;
  return expression.operator === "!=" || expression.operator === "!==" ? "false" : "true";
}

function isNarrowingExpression(expression: ESTree.Expression, parameterName: string): boolean {
  if (expression.type === "ParenthesizedExpression") {
    return isNarrowingExpression(expression.expression, parameterName);
  }
  if (expression.type === "UnaryExpression" && expression.operator === "!") {
    return isNegativeNarrowingExpression(expression.argument, parameterName);
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
    return binaryNarrowingPolarity(expression, parameterName) === "true";
  }
  if (expression.type !== "CallExpression") return false;
  return (
    expression.callee.type === "MemberExpression" &&
    !expression.callee.computed &&
    expression.callee.object.type === "Identifier" &&
    expression.callee.object.name === "Array" &&
    expression.callee.property.type === "Identifier" &&
    expression.callee.property.name === "isArray" &&
    directlyReceivesParameter(expression, parameterName)
  );
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
    if (expression.operator === "&&") {
      return (
        isNegativeNarrowingExpression(expression.left, parameterName) &&
        isNegativeNarrowingExpression(expression.right, parameterName)
      );
    }
    return (
      isNegativeNarrowingExpression(expression.left, parameterName) ||
      isNegativeNarrowingExpression(expression.right, parameterName)
    );
  }
  if (expression.type !== "BinaryExpression") return false;
  return binaryNarrowingPolarity(expression, parameterName) === "false";
}

function expressionReferencesParameter(
  expression: ESTree.Expression,
  parameterName: string,
): boolean {
  if (expression.type === "Identifier") return expression.name === parameterName;
  if (
    expression.type === "ParenthesizedExpression" ||
    expression.type === "ChainExpression" ||
    expression.type === "TSAsExpression" ||
    expression.type === "TSTypeAssertion" ||
    expression.type === "TSNonNullExpression"
  ) {
    return expressionReferencesParameter(expression.expression, parameterName);
  }
  if (expression.type === "AwaitExpression" || expression.type === "UnaryExpression") {
    return expressionReferencesParameter(expression.argument, parameterName);
  }
  if (expression.type === "AssignmentExpression") {
    return (
      (expression.left.type !== "ArrayPattern" &&
        expression.left.type !== "ObjectPattern" &&
        expressionReferencesParameter(expression.left, parameterName)) ||
      expressionReferencesParameter(expression.right, parameterName)
    );
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
      (expression.object.type !== "Super" &&
        expressionReferencesParameter(expression.object, parameterName)) ||
      (expression.computed && expressionReferencesParameter(expression.property, parameterName))
    );
  }
  if (expression.type === "CallExpression" || expression.type === "NewExpression") {
    return (
      (expression.callee.type !== "Super" &&
        expressionReferencesParameter(expression.callee, parameterName)) ||
      expression.arguments.some((argument) =>
        argument.type === "SpreadElement"
          ? expressionReferencesParameter(argument.argument, parameterName)
          : expressionReferencesParameter(argument, parameterName),
      )
    );
  }
  if (expression.type === "SequenceExpression") {
    return expression.expressions.some((item) =>
      expressionReferencesParameter(item, parameterName),
    );
  }
  if (expression.type === "TemplateLiteral") {
    return expression.expressions.some((item) =>
      expressionReferencesParameter(item, parameterName),
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
      return (
        (property.computed &&
          property.key.type !== "PrivateIdentifier" &&
          expressionReferencesParameter(property.key, parameterName)) ||
        expressionReferencesParameter(property.value, parameterName)
      );
    });
  }
  return false;
}

function hasUnparsedParameterReference(
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
    return hasUnparsedParameterReference(expression.expression, parameterName);
  }
  if (expression.type === "AwaitExpression") {
    return hasUnparsedParameterReference(expression.argument, parameterName);
  }
  if (expression.type === "ConditionalExpression") {
    if (!expressionReferencesParameter(expression.test, parameterName)) {
      return (
        hasUnparsedParameterReference(expression.consequent, parameterName) ||
        hasUnparsedParameterReference(expression.alternate, parameterName)
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
    return hasUnparsedParameterReference(expression.object, parameterName);
  }
  if (expression.type !== "CallExpression") {
    return expressionReferencesParameter(expression, parameterName);
  }

  const name = calleeName(expression.callee);
  const isDirectParser =
    (name === "parse" || name === "safeParse") &&
    directlyReceivesParameter(expression, parameterName);
  return expression.arguments.some((argument) => {
    const value = argument.type === "SpreadElement" ? argument.argument : argument;
    if (isDirectParser && value.type === "Identifier" && value.name === parameterName) return false;
    return hasUnparsedParameterReference(value, parameterName);
  });
}

function statementReferencesParameter(statement: ESTree.Statement, parameterName: string): boolean {
  if (statement.type === "BlockStatement") {
    return statement.body.some((child) => statementReferencesParameter(child, parameterName));
  }
  if (statement.type === "ExpressionStatement") {
    return expressionReferencesParameter(statement.expression, parameterName);
  }
  if (statement.type === "ReturnStatement" || statement.type === "ThrowStatement") {
    return (
      statement.argument !== null &&
      expressionReferencesParameter(statement.argument, parameterName)
    );
  }
  if (statement.type === "VariableDeclaration") {
    return statement.declarations.some(
      (declaration) =>
        declaration.init !== null && expressionReferencesParameter(declaration.init, parameterName),
    );
  }
  if (statement.type === "IfStatement") {
    return (
      expressionReferencesParameter(statement.test, parameterName) ||
      statementReferencesParameter(statement.consequent, parameterName) ||
      (statement.alternate !== null &&
        statementReferencesParameter(statement.alternate, parameterName))
    );
  }
  if (statement.type === "DoWhileStatement" || statement.type === "WhileStatement") {
    return (
      expressionReferencesParameter(statement.test, parameterName) ||
      statementReferencesParameter(statement.body, parameterName)
    );
  }
  if (statement.type === "ForStatement") {
    const initializationReferencesParameter =
      statement.init !== null &&
      (statement.init.type === "VariableDeclaration"
        ? statementReferencesParameter(statement.init, parameterName)
        : expressionReferencesParameter(statement.init, parameterName));
    return (
      initializationReferencesParameter ||
      (statement.test !== null && expressionReferencesParameter(statement.test, parameterName)) ||
      (statement.update !== null &&
        expressionReferencesParameter(statement.update, parameterName)) ||
      statementReferencesParameter(statement.body, parameterName)
    );
  }
  if (statement.type === "ForInStatement" || statement.type === "ForOfStatement") {
    return (
      expressionReferencesParameter(statement.right, parameterName) ||
      statementReferencesParameter(statement.body, parameterName)
    );
  }
  if (statement.type === "SwitchStatement") {
    return (
      expressionReferencesParameter(statement.discriminant, parameterName) ||
      statement.cases.some(
        (switchCase) =>
          (switchCase.test !== null &&
            expressionReferencesParameter(switchCase.test, parameterName)) ||
          switchCase.consequent.some((child) => statementReferencesParameter(child, parameterName)),
      )
    );
  }
  if (statement.type === "TryStatement") {
    return (
      statementReferencesParameter(statement.block, parameterName) ||
      (statement.handler !== null &&
        statementReferencesParameter(statement.handler.body, parameterName)) ||
      (statement.finalizer !== null &&
        statementReferencesParameter(statement.finalizer, parameterName))
    );
  }
  if (statement.type === "LabeledStatement" || statement.type === "WithStatement") {
    return statementReferencesParameter(statement.body, parameterName);
  }
  return false;
}

function returnExpressionValidatesParameter(
  expression: ESTree.Expression,
  parameterName: string,
  _hasOutputContract: boolean,
): boolean {
  return (
    (isParserCall(expression, parameterName) &&
      !hasUnparsedParameterReference(expression, parameterName)) ||
    isNarrowingExpression(expression, parameterName) ||
    isNegativeNarrowingExpression(expression, parameterName)
  );
}

function isSafeInspectionExpression(
  expression: ESTree.Expression,
  parameterName: string,
  hasOutputContract: boolean,
): boolean {
  if (!expressionReferencesParameter(expression, parameterName)) return true;
  if (returnExpressionValidatesParameter(expression, parameterName, hasOutputContract)) {
    return true;
  }
  if (expression.type === "ParenthesizedExpression") {
    return isSafeInspectionExpression(expression.expression, parameterName, hasOutputContract);
  }
  if (expression.type === "UnaryExpression") {
    return (
      (expression.operator === "!" || expression.operator === "typeof") &&
      isSafeInspectionExpression(expression.argument, parameterName, hasOutputContract)
    );
  }
  if (expression.type === "BinaryExpression") {
    return (
      equalityOperators.has(expression.operator) ||
      expression.operator === "<" ||
      expression.operator === "<=" ||
      expression.operator === ">" ||
      expression.operator === ">="
    );
  }
  if (expression.type === "LogicalExpression") {
    return (
      isSafeInspectionExpression(expression.left, parameterName, hasOutputContract) &&
      isSafeInspectionExpression(expression.right, parameterName, hasOutputContract)
    );
  }
  return false;
}

function isSafeDiagnosticExpression(
  expression: ESTree.Expression,
  parameterName: string,
  hasOutputContract: boolean,
): boolean {
  if (!expressionReferencesParameter(expression, parameterName)) return true;
  if (isSafeInspectionExpression(expression, parameterName, hasOutputContract)) return true;
  if (
    expression.type === "ParenthesizedExpression" ||
    expression.type === "TSAsExpression" ||
    expression.type === "TSTypeAssertion" ||
    expression.type === "TSNonNullExpression"
  ) {
    return isSafeDiagnosticExpression(expression.expression, parameterName, hasOutputContract);
  }
  if (expression.type === "CallExpression") {
    if (calleeName(expression.callee) !== "runtimeTypeName") return false;
    return expression.arguments.every((argument) => {
      const value = argument.type === "SpreadElement" ? argument.argument : argument;
      return (
        isParameterIdentifier(value, parameterName) ||
        isSafeDiagnosticExpression(value, parameterName, hasOutputContract)
      );
    });
  }
  if (expression.type === "NewExpression") {
    return expression.arguments.every((argument) => {
      const value = argument.type === "SpreadElement" ? argument.argument : argument;
      return isSafeDiagnosticExpression(value, parameterName, hasOutputContract);
    });
  }
  if (expression.type === "ObjectExpression") {
    return expression.properties.every((property) => {
      const value = property.type === "SpreadElement" ? property.argument : property.value;
      return isSafeDiagnosticExpression(value, parameterName, hasOutputContract);
    });
  }
  if (expression.type === "TemplateLiteral") {
    return expression.expressions.every((value) =>
      isSafeDiagnosticExpression(value, parameterName, hasOutputContract),
    );
  }
  return false;
}

function isFailureExpression(
  expression: ESTree.Expression,
  parameterName: string,
  hasOutputContract: boolean,
): boolean {
  if (expression.type !== "CallExpression" || calleeName(expression.callee) !== "fail") {
    return false;
  }
  return expression.arguments.every((argument) => {
    const value = argument.type === "SpreadElement" ? argument.argument : argument;
    return isSafeDiagnosticExpression(value, parameterName, hasOutputContract);
  });
}

type ParameterFlow = {
  readonly safe: boolean;
  readonly exits: boolean;
  readonly narrowedAfter: boolean;
  readonly validated: boolean;
};

function safeFlow(narrowedAfter: boolean, validated: boolean, exits = false): ParameterFlow {
  return { safe: true, exits, narrowedAfter, validated };
}

const unsafeFlow: ParameterFlow = {
  safe: false,
  exits: false,
  narrowedAfter: false,
  validated: false,
};

function analyzeStatementSequence(
  statements: ESTree.Statement[],
  parameterName: string,
  hasOutputContract: boolean,
  initiallyNarrowed: boolean,
): ParameterFlow {
  let narrowed = initiallyNarrowed;
  let validated = initiallyNarrowed;
  for (const statement of statements) {
    const result = analyzeStatement(statement, parameterName, hasOutputContract, narrowed);
    if (!result.safe) return unsafeFlow;
    validated ||= result.validated;
    if (result.exits) return safeFlow(false, validated, true);
    narrowed = result.narrowedAfter;
  }
  return safeFlow(narrowed, validated);
}

function analyzeStatement(
  statement: ESTree.Statement,
  parameterName: string,
  hasOutputContract: boolean,
  narrowed: boolean,
): ParameterFlow {
  if (statement.type === "BlockStatement") {
    return analyzeStatementSequence(statement.body, parameterName, hasOutputContract, narrowed);
  }
  if (statement.type === "ReturnStatement") {
    if (
      statement.argument === null ||
      !expressionReferencesParameter(statement.argument, parameterName)
    ) {
      return safeFlow(false, narrowed, true);
    }
    if (narrowed) return safeFlow(false, true, true);
    const validates = returnExpressionValidatesParameter(
      statement.argument,
      parameterName,
      hasOutputContract,
    );
    return validates || isFailureExpression(statement.argument, parameterName, hasOutputContract)
      ? safeFlow(false, validates, true)
      : unsafeFlow;
  }
  if (statement.type === "ThrowStatement") {
    if (
      !expressionReferencesParameter(statement.argument, parameterName) ||
      narrowed ||
      isSafeDiagnosticExpression(statement.argument, parameterName, hasOutputContract)
    ) {
      return safeFlow(false, narrowed, true);
    }
    return unsafeFlow;
  }
  if (statement.type === "VariableDeclaration") {
    let validated = narrowed;
    for (const declaration of statement.declarations) {
      if (
        declaration.init === null ||
        !expressionReferencesParameter(declaration.init, parameterName) ||
        narrowed
      ) {
        continue;
      }
      if (!returnExpressionValidatesParameter(declaration.init, parameterName, hasOutputContract)) {
        return unsafeFlow;
      }
      validated = true;
    }
    return safeFlow(narrowed, validated);
  }
  if (statement.type === "ExpressionStatement") {
    if (!expressionReferencesParameter(statement.expression, parameterName)) {
      return safeFlow(narrowed, narrowed);
    }
    if (narrowed) return safeFlow(true, true);
    if (statement.expression.type !== "CallExpression") return unsafeFlow;
    const parsesParameter =
      isParserCall(statement.expression, parameterName) &&
      !hasUnparsedParameterReference(statement.expression, parameterName);
    return parsesParameter ? safeFlow(false, true) : unsafeFlow;
  }
  if (statement.type === "IfStatement") {
    if (
      !narrowed &&
      !isSafeInspectionExpression(statement.test, parameterName, hasOutputContract)
    ) {
      return unsafeFlow;
    }
    const positiveNarrowing = isNarrowingExpression(statement.test, parameterName);
    const negativeNarrowing = isNegativeNarrowingExpression(statement.test, parameterName);
    const consequent = analyzeStatement(
      statement.consequent,
      parameterName,
      hasOutputContract,
      narrowed || positiveNarrowing,
    );
    if (!consequent.safe) return unsafeFlow;
    const alternate =
      statement.alternate === null
        ? safeFlow(narrowed || negativeNarrowing, negativeNarrowing)
        : analyzeStatement(
            statement.alternate,
            parameterName,
            hasOutputContract,
            narrowed || negativeNarrowing,
          );
    if (!alternate.safe) return unsafeFlow;
    const validated =
      narrowed ||
      positiveNarrowing ||
      negativeNarrowing ||
      consequent.validated ||
      alternate.validated;
    if (consequent.exits && alternate.exits) return safeFlow(false, validated, true);
    if (consequent.exits) return safeFlow(alternate.narrowedAfter, validated);
    if (alternate.exits) return safeFlow(consequent.narrowedAfter, validated);
    return safeFlow(consequent.narrowedAfter && alternate.narrowedAfter, validated);
  }
  if (narrowed) return safeFlow(true, true);
  return statementReferencesParameter(statement, parameterName)
    ? unsafeFlow
    : safeFlow(narrowed, narrowed);
}

function bodyValidatesParameter(
  body: ESTree.BlockStatement | ESTree.Expression,
  parameterName: string,
  hasOutputContract: boolean,
): boolean {
  if (body.type !== "BlockStatement") {
    return returnExpressionValidatesParameter(body, parameterName, hasOutputContract);
  }
  const result = analyzeStatementSequence(body.body, parameterName, hasOutputContract, false);
  return result.safe && result.validated;
}

function isValidatedUnknownParameter(node: ParameterOwner, name: string): boolean {
  if (node.returnType?.typeAnnotation.type === "TSTypePredicate") {
    return true;
  }
  if (!isRuntimeFunction(node)) {
    return false;
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
