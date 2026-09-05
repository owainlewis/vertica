import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const appRoot = new URL("../app/", import.meta.url).href;

// Node's type stripping does not handle TSX or the app's bundler-style imports.
export async function resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(appRoot) && specifier.startsWith(".")) {
    const base = new URL(specifier, context.parentURL);
    for (const extension of [".ts", ".tsx"]) {
      const candidate = new URL(`${base.href}${extension}`);
      if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith(appRoot) && /\.tsx?$/.test(url)) {
    const source = await readFile(new URL(url), "utf8");
    return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
        fileName: new URL(url).pathname,
      }).outputText,
    };
  }
  return nextLoad(url, context);
}
