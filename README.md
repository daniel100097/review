# codereview-ui

A local code review UI for GitLab merge requests and Forgejo/Gitea pull requests.

Stack: Bun (server + frontend bundler via HTML imports), React, tRPC, TanStack Query, TanStack Virtual, TanStack Highlight, shadcn/ui + Tailwind, Drizzle on `bun:sqlite`.

## Data providers

Review data uses your existing forge CLI login:

| Kind      | CLI                                      | Log in with       |
| --------- | ---------------------------------------- | ----------------- |
| `gitlab`  | [`glab`](https://gitlab.com/gitlab-org/cli) | `glab auth login` |
| `forgejo` | [`fj`](https://codeberg.org/forgejo-contrib/forgejo-cli) | `fj auth login`   |

Add a source (kind + host) on the start page; the server checks it against the forge's `/user` endpoint. GitLab requests use `glab api`. Forgejo requests use its HTTP API with the login saved by `fj` (which has no `api` command). Tokens stay on the server; OAuth logins are refreshed through `fj whoami` when needed.

Forgejo logins are read from `forgejo-cli/keys.json` under `$XDG_DATA_HOME` (default `~/.local/share`) on Linux, `~/Library/Application Support/forgejo-cli.forgejo-cli/keys.json` on macOS, or `%APPDATA%/forgejo-cli/forgejo-cli/data/keys.json` on Windows. Host aliases saved by `fj` are supported, as are installation URLs with a port or path prefix.

## Standalone download

Download the archive for your platform from [GitHub Releases](https://github.com/daniel100097/review/releases), extract it, and run `./codereview-ui`. Open http://localhost:3000. The executable includes the Bun runtime, frontend, database migrations, and ACP adapters; no Bun installation or source checkout is needed.

Install and log in to `fj` or `glab` for your forge. Repository context also needs `git` and SSH access to the repository. AI features use your installed, authenticated `claude` or `codex` CLI. Set `CLAUDE_CODE_EXECUTABLE` or `CODEX_PATH` to override CLI discovery.

The executable stores its database in `~/.local/share/codereview-ui/codereview.sqlite` (or under `XDG_DATA_HOME`). Override it with `DATABASE_PATH`; for example, point it at an existing development database to keep your configured sources. `PORT` changes the HTTP port, and `HOST` changes the bind address (default: `127.0.0.1`). Repository caches respect `XDG_CACHE_HOME`. Run `./codereview-ui --help` for the available settings.

## Builds and releases

Requires Bun 1.4.4 or newer:

```sh
bun install --frozen-lockfile
bun run build
bun scripts/smoke-binary.ts
```

The executable is written to `dist/codereview-ui`. Cross-compile with, for example, `bun run build --target=bun-linux-arm64 --outfile=dist/codereview-ui-arm64`.

[The release workflow](.github/workflows/release.yml) checks types and tests, builds Linux and macOS executables for x64 and ARM64, and smoke-tests each on its native runner. Every build uploads archives as workflow artifacts. Pushing a version tag such as `v0.1.0` also publishes a GitHub Release with the archives and SHA-256 checksums. It uses the repository's built-in `GITHUB_TOKEN`; no personal access token needs to be added.

## Development

```sh
bun install
bun dev          # http://localhost:3000, with HMR
bun test
bun typecheck
```

The SQLite database lives at `codereview.sqlite` (override with `DATABASE_PATH`). Migrations in `drizzle/` run on startup; after changing `src/server/db/schema.ts`, run `bun db:generate`.

## Layout

```
src/
  index.ts                 Bun.serve: SPA + /trpc + /mcp (tools for running agents)
  server/
    router.ts              tRPC procedures
    trpc.ts                sourceProcedure resolves sourceId → provider
    db/                    Drizzle schema (sources, viewed_files, hidden_folders, question threads) + migrator
    providers/
      types.ts             Provider interface and normalized types
      gitlab.ts, forgejo.ts
    agents/
      acp.ts               runs Claude Code or Codex through their ACP adapters
      mcp.ts               per-run MCP tools the agents call back into
      questions.ts         answers questions about diff lines, in the background
      read-only-command.ts which shell commands an agent may run
      walkthrough.ts       groups a pull request's files and summarizes them
    git/
      checkout.ts          bare clone per repo + worktree per pull request head
      attribution.ts       who changed which line of a pull request (git blame)
scripts/
  walkthrough.ts           generates a walkthrough from the command line
  pages/                   sources → repos → pulls → pull
  components/              virtualized diff list, file tree, comments, question threads, layout, shadcn ui/
  lib/                     tRPC client, diff hunk parser, syntax highlighting, hide rules, routes
```

## Expanding unchanged lines

Hunk headers have buttons that show the unchanged lines hidden there, like GitLab's: 20 lines down from the hunk above, 20 up from the hunk below, or all of them; the last hunk gets one for the rest of the file. The first expansion in a file loads it from the forge at the pull request's head commit.

## Changes by contributor

When more than one person committed to a pull request, the Files tab lists them under **Changes by**. Pick one to see only what they changed: files they didn't touch and hunks with only others' changes are left out, and others' lines in what's left are dimmed. The choice is in the URL (`?by=`).

Commits are grouped by email (the same person often commits under several names) and named after their forge account where the forge knows the email; people who only merged aren't listed. Lines are credited with `git blame` over base..head in the local clone (see below; cloned the first time). Deleted lines go to the commit after the last one that had them, or, when that's a merge, to the one author whose commits removed that content; lines that can't be credited count as everyone's.

## Review filters

The Files tab has a sidebar for navigation only: how many files you've viewed, the file tree (or a walkthrough's **Groups**), and the file you're reading, highlighted. Every review filter lives in one **Filters** menu in the toolbar above the diff; each active filter shows next to it as a chip whose ✕ removes just that filter. The sidebar's "N hidden" count opens the same menu mid-review. **Wrap** switches between wrapping and horizontal scrolling; the preference is remembered in your browser.

On phones and tablets a bar at the bottom has **Files** (a drawer with the tree; selecting a file closes it and jumps to its diff), your progress, **Find** and **Next** (the next unviewed file). On touchscreens, tap a line number to ask or comment, and tap a second one to select a range.

**Ctrl+F** (or **Cmd+F**, or the toolbar's magnifying glass) searches code and filenames across the complete filtered diff, including collapsed files. **Enter** finds the next match, **Shift+Enter** the previous one, and **Escape** closes search. Matches are highlighted and scrolled into view even when their rows were not mounted.

All review filters live in the URL. Opening a PR link without filter parameters starts unfiltered, regardless of older browser settings or hidden folders saved for the repository. **Reset filters** clears them together. Copy the full URL to preserve the view, including its custom rules; browser Back and Forward restore previous filter choices.

The query parameters are `hideTests=1`, `hideCommentChanges=1`, `hideReviewComments=1`, `by=<contributor>`, and repeated `hideFolder=<path>` entries. Full custom rules live in the URL fragment as `#rules=<JSON>` (plus `rulesPaused=1` when paused), so large rule sets do not exceed HTTP request URL limits. No saved rule ID or browser storage is needed to open the link elsewhere.

Folders affected by any filter show an amber hidden-file count, including parents of hidden subfolders. Filtered folders stay in the tree so you can see which parts of the change are excluded. The eye next to a folder hides it; hidden folders are listed in **Filters**, where they can be shown again.

**Profiles** (at the bottom of **Filters**) save named setups per repository on the UI server, available across browsers and devices. **Save current as…** captures the applied filters and the AI instruction; apply any rule draft before saving. Choose a saved profile and **Apply** to replace the current PR's filters; under **Manage**, **Update** saves your current setup over it and **Delete** removes it. Profiles never apply automatically, and applying one keeps the complete filter settings in the URL, so shared links work independently of the profile.

Reusable path/line rules and hidden folders work across PRs. Exact AI selections apply only to their original patch; the saved instruction is restored in **Custom filters**, where **Generate** can analyze the current PR again.

## AI agents

Agents run the installed `claude` or `codex` CLI with its existing login, through the [ACP](https://agentclientprotocol.com) adapters `@agentclientprotocol/claude-agent-acp` and `@agentclientprotocol/codex-acp`, as plain subprocesses. Claude gets read tools (Read, Grep, Glob, and a read-only `git` tool on our MCP server), and Codex runs in its read-only mode. `read-only-command.ts` approves permission requests for commands that only read. Agents call back into the server through per-run MCP tools served at `/mcp/<run token>`.

### Flowmark

Open a PR's **Flowmark** tab and select **Generate for this PR**. **Before / after** generates matching explanations for the exact base and head commits, with the viewer's **Changes / Before / After** controls. **Current flow** explains the flow at the head commit. An optional focus can narrow the review to a particular capability. L0 shows the card, risks and checker findings; L1–L3 reveal more detail while keeping risks visible.

Generation uses your selected AI CLI with read-only source tools and the upstream [flowmark-review skill](https://github.com/daniel100097/flowmark/blob/main/skills/flowmark-review/SKILL.md), including its level guide and examples. The backend runs the real [Flowmark](https://github.com/daniel100097/flowmark) WASM parser/checker and TypeScript 5 strict prelude typecheck before accepting the result, then returns its view model through tRPC. The writer reports its capability scope, omitted capabilities, language gaps, unverified citations, and deliberately retained warnings. Reviews and their source documents are saved in the local database per PR and commit pair, so you can return on another device. **Stop** cancels generation; **Regenerate** runs it again with another mode, model or focus, and the previous review stays visible until the new one is done (or if it fails), without its downloads. **Report** holds the writer's report and its counts, and the download button exports the `.review.ts` documents. A review from an earlier PR revision is marked "earlier push".

The upstream viewer runs inside a sandboxed frame, containing its scripts, styles and level fragments. The app passes its colours, fonts and the viewer's shortcuts (`0`–`3` levels, `c` changes, `d`/`b`/`a` views) into the frame by message, so it follows the app's theme without loosening the frame's content security policy. Click a code reference (or focus it and press **Enter**) to copy it. The current upstream checker validates Flowmark structure, not whether citations resolve in the repository; generated claims still need review. No Rust install is required to run the UI: the pinned parser and viewer ship with it. See [the asset provenance and update instructions](src/vendor/flowmark/README.md).

### Custom change filters

Open **Filters** → **Edit rules…** in the Files tab. Describe what matters to you, for example “Show behavior changes; hide changes that only wrap the same values in a requestBody object.” **Generate** gives the AI this pull request's description and diff. It proposes exact changes to hide, with reasons. **Copy prompt for chat** includes the diff so you can ask another chat and paste its returned JSON into **Rules**. Review the proposed exclusions and file/line counts, then select **Apply rules**.

Applied rules are included in the URL. **Pause filters** (or the rules chip's ✕) restores changes hidden by custom rules, and **Clear rules** removes those rules from the URL. Other review filters still apply. Exact selections are tied to a file's patch hash and both sides of a change block: edits to that patch stop those selections from matching. Uncertain changes and blocks omitted from the bounded AI context remain visible.

Reusable text rules are also supported, with case-sensitive path and line globs and no executable code. A path-only rule hides matching files. Line rules hide a consecutive block only when every removed and added line matches that same rule, preserving mixed replacements. When both fields are present, both must match. Paths match the new path relative to the repository root: `*` stays within a directory, `**` crosses directories, and `**/` also matches root files. Line patterns match the full trimmed content; `*` matches any text and `?` one character.

```json
{
  "version": 1,
  "rules": [
    { "name": "Lockfiles", "paths": ["**/package-lock.json", "**/bun.lock"] },
    { "name": "Debug logging", "paths": ["**/*.ts"], "lines": ["console.debug(*)", "console.debug(*);"] }
  ]
}
```

### Questions about diff lines

Use **Hide comments** in the Conversation tab (or **Hide review comments** in **Filters**) to hide pull request comments in both the conversation and the diff, including comments on outdated lines. **Show comments** restores them. The choice is included in the URL.

Click a line's **+** (shift-click another to select a range), type a question and press **Ask** (Ctrl+Enter); **Comment** posts to the forge instead. The answer streams into a thread under the line, with follow-ups that continue the same agent session. Threads are stored locally and marked "earlier push" once the pull request moves on; the agent keeps answering about the commit it was asked on.

For context the agent works in a checkout of the pull request's head commit: each repo is cloned once (bare, over SSH with your git credentials) to `~/.cache/codereview-ui/repos/`, and each head commit gets a worktree in `~/.cache/codereview-ui/worktrees/`, removed after 14 days unused.

### Walkthroughs and review mode

**Analyze** (in the toolbar above the diff) has an agent group the pull request's changed files by purpose, with summaries, risk and a reading order, like CodeRabbit's walkthrough. It works from the patches alone, including files hidden in the UI. The agent hands its result to the server by calling `submit_walkthrough`, which checks that every file is in exactly one group. The result is saved per pull request and marked "earlier push" once it moves on. The default model is Claude Haiku (pick another in Analyze's menu). Once it's done, the same button shows the summary.

With a walkthrough, the sidebar gets a **Groups** view and the diff follows the groups' order, with a band per group. Keys: `j`/`k` next/previous file, `]`/`[` next/previous group, `n` next unviewed file, `v` mark the current file viewed and go to the next unviewed one.

To run one from the command line:

```sh
bun scripts/walkthrough.ts <sourceId> <owner/repo> <number> <claude|codex> [model=sonnet effort=high ...]
```

### Adding a provider

Implement `Provider` from `src/server/providers/types.ts` (typically by wrapping another CLI's `api` command with `run` from `cli.ts`), add its kind to `providerKinds`, register it in `providers/index.ts`, and add a label in `src/pages/sources.tsx`.
