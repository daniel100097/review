/**
 * Decides whether a shell command an agent requests permission to run only reads.
 */

export const gitCommands = ["log", "show", "blame", "diff", "grep", "ls-files", "ls-tree", "rev-parse", "shortlog", "cat-file", "status"];
/** git options that write files or run other programs. */
export const unsafeGitArg = /^(--output|--open-files-in-pager|--ext-diff|--textconv|-O)/;

const isGitReadOnly = (args: string[]) => {
  // Global options before the command: `git -C dir --no-pager log …`.
  let i = 0;
  while (args[i] === "--no-pager" || args[i] === "-C") i += args[i] === "-C" ? 2 : 1;
  return gitCommands.includes(args[i] ?? "") && !args.some(arg => unsafeGitArg.test(arg));
};

const noArg = (pattern: RegExp) => (args: string[]) => !args.some(arg => pattern.test(arg));
const always = () => true;

/** Programs that only read, with checks for the options that would make them write or run something else. */
const programs: Record<string, (args: string[]) => boolean> = {
  rg: noArg(/^--pre(-glob)?\b/),
  grep: always,
  egrep: always,
  fgrep: always,
  cat: always,
  head: always,
  tail: noArg(/^-[a-zA-Z]*f|^--follow/),
  wc: always,
  nl: always,
  ls: always,
  tree: noArg(/^-o$/),
  stat: always,
  file: always,
  pwd: always,
  cd: always,
  echo: always,
  basename: always,
  dirname: always,
  realpath: always,
  du: always,
  diff: always,
  cmp: always,
  jq: always,
  cut: always,
  tr: always,
  true: always,
  sort: noArg(/^-o|^--output/),
  // `uniq in out` writes `out`; only allow it on stdin.
  uniq: args => args.every(arg => arg.startsWith("-")),
  // Only printing line ranges, e.g. `sed -n '10,80p' file`: other scripts can write (`w`) or execute (`e`).
  sed: args => {
    if (!args.includes("-n")) return false;
    const script = args.find(arg => !arg.startsWith("-"));
    return script !== undefined && /^(\d+|\$)(,(\d+|\$))?p$/.test(script);
  },
  find: noArg(/^-(exec|execdir|ok|okdir|delete|fprint0?|fprintf|fls)$/),
  git: isGitReadOnly,
};

/** Redirections that only discard output. */
const harmlessRedirect = /(^|\s)(2>&1|[12]?>\s?\/dev\/null)(?=\s|$)/g;

/**
 * Splits a command into simple commands (by `|`, `||`, `&&` and `;`) of words, or returns undefined if it uses
 * other shell syntax: redirections, expansions, subshells, background jobs.
 */
export function splitCommand(command: string): string[][] | undefined {
  const commands: string[][] = [[]];
  let word: string | undefined;
  let quote: string | undefined;
  const add = (text: string) => (word = (word ?? "") + text);
  const endWord = () => {
    if (word !== undefined) commands.at(-1)!.push(word);
    word = undefined;
  };
  const s = command.replace(harmlessRedirect, " ");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote === "'") {
      if (c === "'") quote = undefined;
      else add(c);
    } else if (quote === '"') {
      if (c === '"') quote = undefined;
      else if (c === "$" || c === "`") return undefined;
      else if (c === "\\" && i + 1 < s.length) add(s[++i]!);
      else add(c);
    } else if (c === "'" || c === '"') {
      quote = c;
      add("");
    } else if (c === "\\" && i + 1 < s.length) {
      add(s[++i]!);
    } else if (c === " " || c === "\t") {
      endWord();
    } else if (c === "|" || c === ";" || (c === "&" && s[i + 1] === "&")) {
      endWord();
      if ((c === "|" || c === "&") && s[i + 1] === c) i++;
      commands.push([]);
    } else if ("&<>$`(){}\n\r".includes(c)) {
      return undefined;
    } else {
      add(c);
    }
  }
  if (quote) return undefined;
  endWord();
  return commands.some(words => words.length === 0) ? undefined : commands;
}

export function isReadOnlyCommand(command: string): boolean {
  const commands = splitCommand(command.trim());
  if (!commands) return false;
  // A whole command quoted as one word, or wrapped in `bash -lc '…'`: check what's inside.
  const [only] = commands;
  if (commands.length === 1 && only!.length === 1 && /\s/.test(only![0]!)) return isReadOnlyCommand(only![0]!);
  if (commands.length === 1 && /^(ba)?sh$/.test(only![0]!) && /^-l?c$/.test(only![1] ?? "") && only!.length === 3) {
    return isReadOnlyCommand(only![2]!);
  }
  return commands.every(([program, ...args]) => programs[program!]?.(args) ?? false);
}
