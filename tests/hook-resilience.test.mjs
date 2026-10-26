// Regression guards for the UserPromptSubmit adapter.
//
// A hook that overruns the host timeout blocks the prompt, so these tests pin the two
// failure modes that used to cause it: stdin that never reaches EOF (readFileSync(0)
// blocked forever) and a route that outlives the host budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'hook.mjs');

function runHook({input, holdStdin = false, env = {}, graceMs = 25000}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK, '--host', 'workbuddy'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {...process.env, ...env},
    });
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    const guard = setTimeout(() => {
      child.kill();
      reject(new Error(`hook did not exit within ${graceMs}ms`));
    }, graceMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(guard);
      resolve({code, stdout, stderr, elapsed: Date.now() - started});
    });
    if (input !== undefined) child.stdin.write(input);
    if (!holdStdin) child.stdin.end();
  });
}

const parseOutput = (stdout) => JSON.parse(stdout.trim());

test('open stdin without EOF still produces a result instead of hanging', async () => {
  const result = await runHook({input: '{"prompt":"保持管道打开', holdStdin: true, graceMs: 20000});
  assert.equal(result.code, 0);
  assert.ok(result.elapsed < 15000, `expected a bounded exit, took ${result.elapsed}ms`);
  const output = parseOutput(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(output.hookSpecificOutput.additionalContext, /动态技能路由器/);
});

test('a completed payload is routed and reported', async () => {
  const result = await runHook({input: JSON.stringify({prompt: '把这些照片批量改名'}), graceMs: 25000});
  assert.equal(result.code, 0);
  const output = parseOutput(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(output.hookSpecificOutput.additionalContext, /contractVersion=4/);
});

test('an exhausted route budget degrades instead of overrunning', async () => {
  const result = await runHook({
    input: JSON.stringify({prompt: '审查并升级系统'}),
    env: {SKILL_ROUTER_BUDGET_MS: '1'},
    graceMs: 20000,
  });
  assert.equal(result.code, 0);
  assert.ok(result.elapsed < 15000, `expected a bounded exit, took ${result.elapsed}ms`);
  const output = parseOutput(result.stdout);
  assert.match(output.hookSpecificOutput.additionalContext, /已降级|routeId=/);
});

test('reused route ids short-circuit without a rebuild', async () => {
  const routeId = '31e02375-0d79-460d-8be3-63101515d46d';
  const result = await runHook({input: JSON.stringify({routeId, prompt: '继续'}), graceMs: 20000});
  assert.equal(result.code, 0);
  const output = parseOutput(result.stdout);
  assert.match(output.hookSpecificOutput.additionalContext, new RegExp(`routeId=${routeId}`));
});
