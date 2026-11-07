import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("persists generated reviews and isolates jobs by repository, source, and commit pair", async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), "flowmark-api-"));
  try {
    const child = Bun.spawn([process.execPath, "--eval", `
      import assert from 'node:assert/strict';
      import { spyOn } from 'bun:test';
      import * as providers from './src/server/providers';
      import * as writer from './src/server/agents/flowmark';
      import { db } from './src/server/db';
      import { sources, flowmarkReviews } from './src/server/db/schema';
      const baseSha = 'a'.repeat(40), headSha = 'b'.repeat(40);
      spyOn(providers, 'createProvider').mockReturnValue({ getPull: async () => ({baseSha, headSha}) });
      let release, stopped = false;
      const generation = spyOn(writer, 'generateFlowmark').mockImplementation(async opts => new Promise((resolve,reject) => {
        release = () => resolve({base:'before source', head:'after source', result:{model_version:1,title:'Generated review',diagnostics:[]}});
        opts.signal.addEventListener('abort', () => {stopped=true;reject(new Error('Cancelled'));}, {once:true});
      }));
      db.insert(sources).values([
        {id:1,kind:'forgejo',host:'example.test',username:'reviewer'},
        {id:2,kind:'gitlab',host:'other.test',username:'reviewer'}
      ]).run();
      const { flowmarkRouter } = await import('./src/server/flowmark');
      const api = flowmarkRouter.createCaller({});
      const input = {sourceId:1,repo:'owner/repo',number:7,baseSha,headSha,mode:'changes',request:'Explain mail',agent:'codex',model:'test'};
      assert.equal(await api.latest(input), null);
      await assert.rejects(api.start({...input,headSha:'c'.repeat(40)}), {code:'CONFLICT'});
      assert.equal(generation.mock.calls.length,0);
      const id = await api.start(input);
      assert.equal((await api.latest(input)).status, 'running');
      await assert.rejects(api.start(input), {code:'CONFLICT'});
      await api.cancel({...input,sourceId:2,id});
      await api.cancel({...input,repo:'owner/other',id});
      assert.equal(stopped,false);
      assert.equal(await api.latest({...input,sourceId:2}),null);
      assert.equal(await api.latest({...input,repo:'owner/other'}),null);
      release();
      await new Promise(resolve=>setTimeout(resolve,10));
      const saved = await api.latest(input);
      assert.equal(saved.status,'done');
      assert.equal(saved.baseSha,baseSha);
      assert.equal(saved.headSha,headSha);
      assert.equal(saved.headSource,'after source');
      assert.equal(saved.result.title,'Generated review');
      const next = await api.start({...input,mode:'walkthrough'});
      await api.cancel({...input,id:next});
      await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(stopped,true);
      assert.equal((await api.latest(input)).status,'cancelled');
      assert.equal(db.select().from(flowmarkReviews).all().length,2);
    `], {
      cwd: path.resolve(import.meta.dir, "../.."), env: { ...process.env, DATABASE_PATH: path.join(scratch, "test.sqlite") },
      stdout: "pipe", stderr: "pipe", timeout: 10_000,
    });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
    // A fresh process reads the saved result, independently of jobs or previous module state.
    const read = Bun.spawn([process.execPath, "--eval", `
      import assert from 'node:assert/strict';
      import { db } from './src/server/db';
      import { flowmarkReviews } from './src/server/db/schema';
      const rows=db.select().from(flowmarkReviews).all();
      assert.equal(rows[0].headSource,'after source');assert.equal(rows[0].result.title,'Generated review');
    `], {
      cwd: path.resolve(import.meta.dir, "../.."), env: { ...process.env, DATABASE_PATH: path.join(scratch, "test.sqlite") },
      stdout: "pipe", stderr: "pipe", timeout: 5000,
    });
    const [readCode, readErrors] = await Promise.all([read.exited, new Response(read.stderr).text()]);
    expect({ readCode, readErrors }).toEqual({ readCode: 0, readErrors: "" });
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
