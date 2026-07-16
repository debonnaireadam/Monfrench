import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function readRepoFile(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

export function collectTextFiles(roots, options = {}) {
  const extensions = new Set(options.extensions ?? [".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".ts", ".tsx"]);
  const ignoredDirectories = new Set(options.ignoredDirectories ?? [".git", ".next", "dist", "node_modules", "output", "reference", "tmp"]);
  const files = [];

  function visit(absolutePath) {
    if (!existsSync(absolutePath)) return;
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      const child = join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) visit(child);
      } else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
        files.push({
          path: relative(repoRoot, child).replaceAll("\\", "/"),
          text: readFileSync(child, "utf8"),
        });
      }
    }
  }

  for (const root of roots) {
    const absolutePath = resolve(repoRoot, root);
    if (!existsSync(absolutePath)) continue;
    if (extname(absolutePath)) {
      files.push({ path: relative(repoRoot, absolutePath).replaceAll("\\", "/"), text: readFileSync(absolutePath, "utf8") });
    } else {
      visit(absolutePath);
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function combinedSource(files) {
  return files.map(({ path, text }) => `\n/* ${path} */\n${text}`).join("\n");
}
