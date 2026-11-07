import viewerScript from "../vendor/flowmark/viewer.js.txt";
import viewerCss from "../vendor/flowmark/viewer.css.txt";
import type { FlowmarkModel } from "./flowmark";

/** Keep untrusted review text inside JSON and the upstream viewer's text nodes. */
export function flowmarkDocument(model: FlowmarkModel): string {
  const json = JSON.stringify(model).replaceAll("<", "\\u003c");
  // The embedded viewer has its own scroll/keys; app filters own the parent URL.
  const script = viewerScript.replaceAll("if (global.history && global.location)", "if (false)");
  const colors = [...viewerCss.matchAll(/:root \{([^}]+)\}/g)];
  const styles = `${viewerCss}\n:root[data-theme=light] {${colors[0]?.[1]}}\n:root[data-theme=dark] {${colors[1]?.[1]}}`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<style>${styles}
body { margin:0; background:var(--bg); color:var(--fg); }
button:focus-visible, a:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
.fm-title, .fm-card, .fm-list, .fm-changes { overflow-wrap:anywhere; }
.fm-list li { flex-wrap:wrap; }
.fm-code { overflow-x:auto; }
@media(max-width:480px) { main {padding:8px 8px 24px;} .fm-header {padding:8px;gap:8px;} .fm-levels {max-width:100%;flex-wrap:wrap;} .fm-levels button {padding:7px 9px;} }
</style></head><body><div id="review" class="flowmark"></div>
<script type="application/json" id="model">${json}</script>
<script>${script}
window.addEventListener('message', event => {
  if (event.source === parent && event.data?.type === 'flowmark-theme') document.documentElement.dataset.theme = event.data.dark ? 'dark' : 'light';
});
document.addEventListener('click', event => {
  const ref = event.target.closest?.('.ref');
  if (!ref) return;
  event.stopImmediatePropagation();
  const lines = ref.title.split('\\n');
  const target = lines.find(line => line.startsWith('target: '))?.slice(8) || '';
  const quote = lines.find(line => line.startsWith('quote: '))?.slice(7) || '';
  parent.postMessage({type:'flowmark-copy', text:[target, quote && JSON.stringify(quote)].filter(Boolean).join(' ')}, '*');
}, true);
try { Flowmark.mount(document.getElementById('review'), JSON.parse(document.getElementById('model').textContent), {level:1}); }
catch (error) { document.getElementById('review').textContent = 'Could not display Flowmark: ' + error.message; }
</script></body></html>`;
}
