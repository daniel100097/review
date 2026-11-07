import wasmPath from "../vendor/flowmark/flowmark.wasm" with { type: "file" };
import { z } from "zod";
import { flowmarkSourcesSchema, type FlowmarkModel, type FlowmarkSources } from "@/lib/flowmark";

/** Runs once per child: no parser state or leaked syntax trees survive a request. */
export async function runFlowmarkParser() {
  const { checkFlowmarkTypes } = await import("./flowmark-typecheck");
  const { base, head, preview } = flowmarkSourcesSchema.extend({ preview: z.boolean().optional() }).parse(JSON.parse(await Bun.stdin.text()));
  const { instance } = await WebAssembly.instantiate(await Bun.file(wasmPath).arrayBuffer(), {});
  const w = instance.exports as {
    memory: WebAssembly.Memory;
    fm_alloc: (length: number) => number;
    fm_model_version: () => number;
    fm_model: (...args: number[]) => number;
    fm_diff_model: (...args: number[]) => number;
    fm_view: (ptr: number, length: number, level: number) => number;
    fm_result_ptr: () => number;
  };
  if (w.fm_model_version() !== 1) throw new Error("Unsupported Flowmark model version");
  const args: number[] = [];
  const texts = base ? [base, "before.review.ts", head, "after.review.ts"] : [head, "review.review.ts"];
  for (const text of texts) {
    const bytes = new TextEncoder().encode(text);
    const ptr = w.fm_alloc(bytes.length);
    new Uint8Array(w.memory.buffer, ptr, bytes.length).set(bytes);
    args.push(ptr, bytes.length);
  }
  const length = base ? w.fm_diff_model(...args) : w.fm_model(...args);
  const model = JSON.parse(new TextDecoder().decode(new Uint8Array(w.memory.buffer, w.fm_result_ptr(), length))) as FlowmarkModel;
  const sides = model.sides as { base: FlowmarkModel; head: FlowmarkModel } | undefined;
  if (sides) {
    for (const [side, text] of [[sides.base, base], [sides.head, head]] as const) {
      side.diagnostics.push(...checkFlowmarkTypes(text));
      side.typechecked = !side.diagnostics.some(d => d.code.startsWith("TS"));
    }
    // In Changes mode the viewer's top-level findings describe the head.
    model.diagnostics.push(...sides.head.diagnostics.filter(d => d.code.startsWith("TS")));
    model.typechecked = Boolean(sides.base.typechecked && sides.head.typechecked);
  } else {
    model.diagnostics.push(...checkFlowmarkTypes(head));
    model.typechecked = !model.diagnostics.some(d => d.code.startsWith("TS"));
  }
  if (preview) {
    const view = (source: string, level: number) => {
      const bytes = new TextEncoder().encode(source);
      const ptr = w.fm_alloc(bytes.length);
      new Uint8Array(w.memory.buffer, ptr, bytes.length).set(bytes);
      const size = w.fm_view(ptr, bytes.length, level);
      return new TextDecoder().decode(new Uint8Array(w.memory.buffer, w.fm_result_ptr(), size));
    };
    model.previews = {
      ...(base ? { base: { card: view(base, 0), flow: view(base, 1) } } : {}),
      head: { card: view(head, 0), flow: view(head, 1) },
    };
  }
  // Parsing never evaluates the review's pseudo-TypeScript.
  process.stdout.write(JSON.stringify(model));
}

let activeParses = 0;
export async function parseFlowmark(sources: FlowmarkSources, signal?: AbortSignal, preview = false): Promise<FlowmarkModel> {
  const input = flowmarkSourcesSchema.parse(sources);
  if (signal?.aborted) throw new Error("Cancelled");
  if (activeParses >= 2) throw new Error("Flowmark is busy. Try again in a moment.");
  activeParses++;
  try {
    const child = Bun.spawn(Bun.isStandaloneExecutable
      ? [process.execPath, "--flowmark-parser"]
      : [process.execPath, new URL("./flowmark-parser-entry.ts", import.meta.url).pathname], {
      stdin: new Response(JSON.stringify({ ...input, preview })), stdout: "pipe", stderr: "pipe", timeout: 15_000, killSignal: "SIGKILL",
    });
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const [code, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      if (signal?.aborted) throw new Error("Cancelled");
      if (code !== 0) throw new Error(`Flowmark could not parse this review${child.signalCode ? " (parser timed out or stopped)" : `: ${stderr.slice(-1000)}`}`);
      const model = JSON.parse(stdout) as FlowmarkModel;
      if (model.model_version !== 1 || !Array.isArray(model.diagnostics)) throw new Error("Invalid Flowmark view model");
      return model;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  } finally {
    activeParses--;
  }
}
