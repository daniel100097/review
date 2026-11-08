import { EmptyState, Page } from "@/components/page";
import { PullPage } from "@/pages/pull";
import { PullsPage } from "@/pages/pulls";
import { ReposPage } from "@/pages/repos";
import { SourcesPage } from "@/pages/sources";
import { routes } from "@/lib/routes";
import { Link, Route, Switch } from "wouter";
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
          <EmptyState>
            Page not found.{" "}
            <Link href={routes.sources()} className="text-foreground underline underline-offset-4">
              Back to sources
            </Link>
          </EmptyState>
        </Page>
      </Route>
    </Switch>
  );
}

/** Repo paths can contain slashes, so PR pages are separated GitLab-style: `<repo>/-/pulls/<n>`. */
function RepoRoute({ sourceId, path }: { sourceId: number; path: string }) {
  const pull = path.match(/^(.+)\/-\/pulls\/(\d+)$/);
  return pull ? (
    <PullPage key={`${sourceId}:${pull[1]}:${pull[2]}`} sourceId={sourceId} repo={pull[1]!} number={Number(pull[2])} />
  ) : (
    <PullsPage sourceId={sourceId} repo={path} />
  );
}

export default App;
