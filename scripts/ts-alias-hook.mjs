/**
 * Module resolution for running the app's TypeScript from a plain script.
 *
 * Node 22 strips types on its own, but it does not know two things the
 * bundler does: the `@/*` path alias from `tsconfig.json`, and that
 * `import "./seed"` means `./seed.ts`. Both are resolved here so the seed
 * script can import the real fixtures rather than a copy of them — a second
 * copy of 1,500 lines of seed data would drift from the first within a week.
 */

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".js", "/index.ts", "/index.tsx"];

function firstExisting(basePath) {
  for (const extension of EXTENSIONS) {
    const candidate = basePath + extension;
    if (existsSync(candidate) && !candidate.endsWith("/")) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const found = firstExisting(resolvePath(ROOT, "src", specifier.slice(2)));
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }

  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const parent = dirname(fileURLToPath(context.parentURL));
    const found = firstExisting(resolvePath(parent, specifier));
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }

  return nextResolve(specifier, context);
}
