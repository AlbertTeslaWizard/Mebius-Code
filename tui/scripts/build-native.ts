// @ts-nocheck
import solidPlugin from "@opentui/solid/bun-plugin";
import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
let outfile = process.platform === "win32" ? "dist/native/mebius.exe" : "dist/native/mebius";

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];

  if (arg === "--outfile") {
    const next = args[index + 1];
    if (!next) {
      console.error("Missing value for --outfile");
      process.exit(1);
    }

    outfile = next;
    index += 1;
    continue;
  }

  if (arg.startsWith("--outfile=")) {
    outfile = arg.slice("--outfile=".length);
    continue;
  }

  console.error(`Unknown argument: ${arg}`);
  process.exit(1);
}

const result = await Bun.build({
  entrypoints: ["./src/native-entry.tsx"],
  target: "bun",
  plugins: [solidPlugin],
  compile: {
    outfile,
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }

  process.exit(1);
}

console.log(`Built ${outfile}`);

await stageNativeRuntime(dirname(outfile));

async function stageNativeRuntime(nativeDir) {
  const runtimeDir = join(nativeDir, "runtime");
  await rm(runtimeDir, { recursive: true, force: true });
  await mkdir(runtimeDir, { recursive: true });

  await copyFile(
    join("node_modules", "@opentui", "core", "parser.worker.js"),
    join(runtimeDir, "parser.worker.js"),
  );

  const assetsDestination = join(runtimeDir, "assets");
  for (const assetDir of ["javascript", "typescript", "markdown", "markdown_inline", "zig"]) {
    await copyDirectory(
      join("node_modules", "@opentui", "core", "assets", assetDir),
      join(assetsDestination, assetDir),
    );
  }

  const webTreeSitterDestination = join(runtimeDir, "node_modules", "web-tree-sitter");
  await mkdir(webTreeSitterDestination, { recursive: true });
  for (const file of ["package.json", "tree-sitter.js", "tree-sitter.wasm"]) {
    await copyFile(
      join("node_modules", "web-tree-sitter", file),
      join(webTreeSitterDestination, file),
    );
  }
}

async function copyDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source)) {
    const sourcePath = join(source, entry);
    const destinationPath = join(destination, entry);
    const info = await stat(sourcePath);
    if (info.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
    } else if (info.isFile()) {
      await copyFile(sourcePath, destinationPath);
    }
  }
}
