/** Runs a forge CLI. Throws with the CLI's first stderr line if it exits non-zero. */
export async function run(cmd: string[], stdin?: string) {
  const proc = Bun.spawn(cmd, {
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw cliError(cmd, stderr || `exited with code ${code}`);
  return { stdout, stderr };
}

export function cliError(cmd: string[], stderr: string) {
  const message = stderr.trim().split("\n")[0]!;
  return new Error(message.startsWith(`${cmd[0]}:`) ? message : `${cmd[0]}: ${message}`);
}
