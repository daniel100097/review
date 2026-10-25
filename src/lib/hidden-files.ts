/** Tests, snapshots, mocks and generated code: files a reviewer usually skips. */
const testOrGenerated =
  /\.(spec|test)\.\w+$|_test\.go$|-snapshots\/|(^|\/)(e2e|ct|tests?|testdata|__tests__|__mocks__|playwright)\/|(^|\/)(init-testing\.ts|(playwright|vitest)[\w-]*\.config\.\w+)$|(^|\/)generated\/|\.gen\.\w+$|^packages\/panel\/src\/lib\/openapi\/|openapi\.json$/;

type Paths = { newPath: string; oldPath: string };

export const isTestOrGenerated = (file: Paths) => testOrGenerated.test(file.newPath) || testOrGenerated.test(file.oldPath);

/** Returns the hidden folder containing `path` (or equal to it), if any. */
export const hiddenFolderOf = (path: string, hiddenFolders: readonly string[]) =>
  hiddenFolders.find(folder => path === folder || path.startsWith(`${folder}/`));

export const isInHiddenFolder = (file: Paths, hiddenFolders: readonly string[]) =>
  hiddenFolderOf(file.newPath, hiddenFolders) !== undefined || hiddenFolderOf(file.oldPath, hiddenFolders) !== undefined;
