export const routes = {
  sources: () => "/",
  source: (sourceId: number) => `/s/${sourceId}`,
  repo: (sourceId: number, repo: string) => `/s/${sourceId}/r/${repo}`,
  pull: (sourceId: number, repo: string, number: number) => `/s/${sourceId}/r/${repo}/-/pulls/${number}`,
};
