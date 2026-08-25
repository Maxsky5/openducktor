import { readFileSync } from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import ts from "typescript";

import {
  classifyNamedAliasWideningTarget,
  classifyNamedInterfaceWideningTarget,
  createWideningModuleEnvironment,
  type WideningTypeEnvironment,
  type WideningTarget,
} from "./widening-target.ts";

import type { PortableModuleItem, PortableNode } from "./portable-ast.ts";

type ParsedModule = {
  readonly environment: WideningTypeEnvironment;
  readonly statements: readonly PortableModuleItem[];
};

type ImportedBinding = {
  readonly exportedName: string;
  readonly moduleSpecifier: string;
};

const moduleCache = new Map<string, ParsedModule>();
const targetCache = new Map<string, WideningTarget | null>();
const optionsCache = new Map<string, ts.CompilerOptions>();

function compilerOptions(filename: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(path.dirname(filename), ts.sys.fileExists);
  if (configPath === undefined) return {};
  const cached = optionsCache.get(configPath);
  if (cached !== undefined) return cached;
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  }
  const options = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  ).options;
  optionsCache.set(configPath, options);
  return options;
}

function resolveModule(filename: string, moduleSpecifier: string): string | null {
  const resolved = ts.resolveModuleName(
    moduleSpecifier,
    filename,
    compilerOptions(filename),
    ts.sys,
  ).resolvedModule;
  return resolved === undefined ? null : path.resolve(resolved.resolvedFileName);
}

function parsedModule(filename: string): ParsedModule {
  const cached = moduleCache.get(filename);
  if (cached !== undefined) return cached;
  const result = parseSync(filename, readFileSync(filename, "utf8"));
  const parseError = result.errors.find((error) => error.severity === "Error");
  if (parseError !== undefined) {
    throw new Error(`Cannot inspect imported type in ${filename}: ${parseError.message}`);
  }
  const statements = result.program.body;
  const parsed = {
    environment: createWideningModuleEnvironment(statements),
    statements,
  };
  moduleCache.set(filename, parsed);
  return parsed;
}

function declarationName(declaration: PortableNode | null): string | null {
  if (
    declaration?.type === "TSTypeAliasDeclaration" ||
    declaration?.type === "TSInterfaceDeclaration"
  ) {
    return declaration.id.name;
  }
  return null;
}

function importedBinding(module: ParsedModule, localName: string): ImportedBinding | null {
  for (const statement of module.statements) {
    if (statement.type !== "ImportDeclaration") continue;
    for (const specifier of statement.specifiers) {
      if (specifier.local.name !== localName) continue;
      if (specifier.type === "ImportDefaultSpecifier") {
        return { exportedName: "default", moduleSpecifier: statement.source.value };
      }
      if (specifier.type === "ImportNamespaceSpecifier") return null;
      return {
        exportedName:
          specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : specifier.imported.value,
        moduleSpecifier: statement.source.value,
      };
    }
  }
  return null;
}

function localTarget(
  filename: string,
  module: ParsedModule,
  localName: string,
  resolving: ReadonlySet<string>,
): WideningTarget | null {
  const aliasTarget = classifyNamedAliasWideningTarget(localName, module.environment);
  if (aliasTarget !== null) return aliasTarget;
  const interfaceTarget = classifyNamedInterfaceWideningTarget(localName, module.environment);
  if (interfaceTarget !== null) return interfaceTarget;
  const imported = importedBinding(module, localName);
  return imported === null
    ? null
    : importedTarget(filename, imported.moduleSpecifier, imported.exportedName, resolving);
}

function importedTarget(
  containingFile: string,
  moduleSpecifier: string,
  exportedName: string,
  resolving: ReadonlySet<string>,
): WideningTarget | null {
  const filename = resolveModule(containingFile, moduleSpecifier);
  if (filename === null) return null;
  const cacheKey = `${filename}\0${exportedName}`;
  if (targetCache.has(cacheKey)) return targetCache.get(cacheKey) ?? null;
  if (resolving.has(cacheKey)) return null;
  const nextResolving = new Set(resolving);
  nextResolving.add(cacheKey);
  const module = parsedModule(filename);

  for (const statement of module.statements) {
    if (statement.type === "ExportNamedDeclaration") {
      if (declarationName(statement.declaration) === exportedName) {
        const target = localTarget(filename, module, exportedName, nextResolving);
        targetCache.set(cacheKey, target);
        return target;
      }
      for (const specifier of statement.specifiers) {
        const exported =
          specifier.exported.type === "Identifier"
            ? specifier.exported.name
            : specifier.exported.value;
        if (exported !== exportedName) continue;
        const local =
          specifier.local.type === "Identifier" ? specifier.local.name : specifier.local.value;
        const target =
          statement.source === null
            ? localTarget(filename, module, local, nextResolving)
            : importedTarget(filename, statement.source.value, local, nextResolving);
        targetCache.set(cacheKey, target);
        return target;
      }
    }
    if (statement.type === "ExportAllDeclaration") {
      const target = importedTarget(filename, statement.source.value, exportedName, nextResolving);
      if (target !== null) {
        targetCache.set(cacheKey, target);
        return target;
      }
    }
  }

  targetCache.set(cacheKey, null);
  return null;
}

/** Classify an imported alias or interface through its source declarations and re-exports. */
export function classifyImportedWideningTarget(
  containingFile: string,
  moduleSpecifier: string,
  exportedName: string,
): WideningTarget | null {
  return importedTarget(containingFile, moduleSpecifier, exportedName, new Set());
}
