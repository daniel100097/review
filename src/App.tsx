import { Page } from "@/components/page";
import { PullPage } from "@/pages/pull";
import { PullsPage } from "@/pages/pulls";
import { ReposPage } from "@/pages/repos";
import { SourcesPage } from "@/pages/sources";
import { Route, Switch } from "wouter";
import "./index.css";

export function App() {
  return (
    <Switch>
      <Route path="/" component={SourcesPage} />
      <Route path="/s/:sourceId">{params => <ReposPage sourceId={Number(params.sourceId)} />}</Route>
      <Route path="/s/:sourceId/r/*">
        {params => <RepoRoute sourceId={Number(params.sourceId)} path={params["*"]} />}
      </Route>
      <Route>
        <Page crumbs={[{ label: "Not found" }]}>
          <p className="text-muted-foreground">Page not found.</p>
        </Page>
      </Route>
    </Switch>
  );
}

/** Repo paths can contain slashes, so PR pages are separated GitLab-style: `<repo>/-/pulls/<n>`. */
function RepoRoute({ sourceId, path }: { sourceId: number; path: string }) {
  const pull = path.match(/^(.+)\/-\/pulls\/(\d+)$/);
  return pull ? (
    <PullPage sourceId={sourceId} repo={pull[1]!} number={Number(pull[2])} />
  ) : (
    <PullsPage sourceId={sourceId} repo={path} />
  );
}

export default App;
