import tailwind from "bun-plugin-tailwind";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    target: { type: "string" },
    outfile: { type: "string", default: "dist/codereview-ui" },
  },
});

const result = await Bun.build({
  entrypoints: ["./src/cli.ts"],
  target: "bun",
  env: "disable",
  minify: true,
  plugins: [tailwind],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  compile: {
    ...(values.target ? { target: values.target as Bun.Build.CompileTarget } : {}),
    outfile: values.outfile,
    assets: ["./drizzle"],
    autoloadDotenv: false,
    autoloadBunfig: false,
  },
});
if (!result.success) throw new AggregateError(result.logs, "Executable build failed");
console.log(`Built ${values.outfile}`);
