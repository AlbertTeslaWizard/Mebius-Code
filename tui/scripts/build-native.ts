// @ts-nocheck
import solidPlugin from "@opentui/solid/bun-plugin";

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
