import ts from "typescript-flowmark";
import libs from "../vendor/flowmark/typescript-libs.json";
import prelude from "../vendor/flowmark/prelude.txt";

/** A closed virtual filesystem: checking a review never reads project files or executes it. */
export function checkFlowmarkTypes(source: string) {
  const files: Record<string, string> = { ...libs, "review.ts": source, "prelude.d.ts": prelude };
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts"],
    strict: true, noUnusedLocals: true, noEmit: true, types: [],
  };
  const name = (file: string) => file.replace(/^.*\//, "");
  const host: ts.CompilerHost = {
    getSourceFile: (file, languageVersion) => files[name(file)] === undefined ? undefined : ts.createSourceFile(file, files[name(file)]!, languageVersion),
    getDefaultLibFileName: () => "lib.es2022.d.ts", writeFile: () => {},
    getCurrentDirectory: () => "/", getDirectories: () => [],
    fileExists: file => files[name(file)] !== undefined,
    readFile: file => files[name(file)],
    getCanonicalFileName: file => file, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
  };
  const program = ts.createProgram(["review.ts", "prelude.d.ts"], options, host);
  return ts.getPreEmitDiagnostics(program).map(diagnostic => ({
    severity: "error" as const,
    code: `TS${diagnostic.code}`,
    message: `${diagnostic.file && name(diagnostic.file.fileName) !== "review.ts" ? `${name(diagnostic.file.fileName)}: ` : ""}${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
    line: diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : 1,
  }));
}
