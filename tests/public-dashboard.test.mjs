import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';
import {runOptionalDashboard} from '../src/sync-installed-skills.mjs';

// Inject both filesystem and execution behavior: these checks start no process.
const sourceDir = path.join('fictional', 'router', 'src');
const dashboard = path.join(sourceDir, 'generate-dashboard.mjs');

test('an absent private dashboard is skipped without calling a runner', () => {
  const checked = [];
  let calls = 0;
  const result = runOptionalDashboard({
    sourceDir,
    exists: file => {checked.push(file); return false;},
    run: () => {calls += 1;},
  });
  assert.equal(result, false);
  assert.deepEqual(checked, [dashboard]);
  assert.equal(calls, 0);
});

test('an available dashboard keeps the original command and stdio options', () => {
  const calls = [];
  const result = runOptionalDashboard({
    sourceDir,
    exists: file => file === dashboard,
    run: (...args) => {calls.push(args);},
  });
  assert.equal(result, true);
  assert.deepEqual(calls, [[process.execPath, [dashboard], {stdio: ['ignore', 'ignore', 'pipe']}]]);
});

test('a supplied dashboard failure still propagates to the caller', () => {
  assert.throws(() => runOptionalDashboard({
    sourceDir,
    exists: () => true,
    run: () => {throw new Error('fictional generator failure');},
  }), /fictional generator failure/);
});
