#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import {canonicalHost} from './host-manifest.mjs';
import {LOG_ROOT} from './paths.mjs';

const HOST_INDEX = process.argv.indexOf('--host');
const host = HOST_INDEX >= 0 ? process.argv[HOST_INDEX + 1] : 'generic';
const routerHost = canonicalHost(host);
const ROUTER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE_WORKER = new URL('./route-worker.mjs', import.meta.url);
const CLI = path.join(ROUTER_ROOT, 'src', 'cli.mjs');
const REFRESH_MARKER = path.join(LOG_ROOT, '.hook-refresh.json');

// A UserPromptSubmit hook that overruns the host timeout blocks the prompt, so every
// stage below carries its own deadline and always produces usable output. The route
// budget stays well inside the configured host timeout (see ~/.workbuddy/settings.json).
const budget = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const STDIN_BUDGET_MS = budget(process.env.SKILL_ROUTER_STDIN_MS, 2000);
const ROUTE_BUDGET_MS = budget(process.env.SKILL_ROUTER_BUDGET_MS, 10000);
const COLD_ROUTE_MS = budget(process.env.SKILL_ROUTER_COLD_MS, 2000);
const REFRESH_THROTTLE_MS = 5 * 60 * 1000;

const ROUTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTE_MARKER = /\[动态技能路由器\]\s*routeId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const findPrompt = (input) => input.prompt || input.user_prompt || input.userPrompt || input.message || input.input || input?.request?.prompt || '';

function routeIdFromVisible(value) {
  if (typeof value === 'string') return value.match(ROUTE_MARKER)?.[1] || '';
  if (Array.isArray(value)) {
    for (const item of [...value].reverse()) {
      const found = routeIdFromVisible(item);
      if (found) return found;
    }
    return '';
  }
  if (!value || typeof value !== 'object') return '';
  const role = String(value.role || value.author || value.type || '').toLowerCase();
  if (role === 'user' || role === 'human') return '';
  for (const key of ['additionalContext', 'ephemeralMessage', 'content', 'text', 'message', 'messages', 'context']) {
    const found = routeIdFromVisible(value[key]);
    if (found) return found;
  }
  return '';
}

function routeIdFromTranscript(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  const lines = fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-200).reverse();
  for (const line of lines) {
    try {
      const found = routeIdFromVisible(JSON.parse(line));
      if (found) return found;
    } catch { /* Skip malformed transcript lines. */ }
  }
  return '';
}

function textFromContent(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromContent).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  for (const key of ['text', 'content', 'message', 'prompt', 'userMessage', 'user_message']) {
    const text = textFromContent(value[key]);
    if (text) return text;
  }
  return '';
}

function findUserMessage(value) {
  if (!value || typeof value !== 'object') return '';
  const role = String(value.role || value.author || value.type || value.kind || '').toLowerCase();
  if (role === 'user' || role === 'human' || role.includes('user_message') || role.includes('usermessage')) {
    return textFromContent(value.content ?? value.message ?? value.text ?? value.prompt);
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = findUserMessage(child);
      if (found) return found;
    }
  }
  return '';
}

function promptFromTranscript(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  const lines = fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-200).reverse();
  for (const line of lines) {
    try {
      const prompt = findUserMessage(JSON.parse(line));
      if (prompt) return prompt;
    } catch {
      // Ignore malformed or partially-written transcript lines.
    }
  }
  return '';
}

function fallbackContext(reason) {
  return `[动态技能路由器]\n${reason} 可使用 route_task(contractVersion: 4)，把用户最新完整需求作为 query；若入口不可用，说明后以原生能力继续。`;
}

// Reading fd 0 synchronously deadlocks whenever the host leaves the pipe open and waits
// for this process to exit first. Read asynchronously with a deadline and always release
// the handle, otherwise a pending read keeps the event loop alive.
function readStdinWithDeadline(ms) {
  return new Promise((resolve) => {
    if (!process.stdin || process.stdin.isTTY) { resolve(''); return; }
    let raw = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        process.stdin.pause();
        process.stdin.removeAllListeners('data');
        process.stdin.removeAllListeners('end');
        process.stdin.removeAllListeners('error');
        process.stdin.removeAllListeners('close');
        if (typeof process.stdin.unref === 'function') process.stdin.unref();
      } catch { /* stdin may already be released. */ }
      resolve(raw);
    };
    const timer = setTimeout(finish, ms);
    try {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { raw += chunk; });
      process.stdin.on('end', finish);
      process.stdin.on('close', finish);
      process.stdin.on('error', finish);
      process.stdin.resume();
    } catch { finish(); }
  });
}

function routeWithinBudget(prompt, input) {
  return new Promise((resolve) => {
    let settled = false;
    let worker;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const stopping = worker.terminate();
        if (stopping && typeof stopping.catch === 'function') stopping.catch(() => {});
      } catch { /* Worker already stopped. */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), ROUTE_BUDGET_MS);
    try {
      worker = new Worker(ROUTE_WORKER, {
        workerData: {
          prompt, host: routerHost, taskContext: input.taskContext,
          runtimeSkills: input.runtimeSkills, runtimeCapabilities: input.runtimeCapabilities,
          projectRoot: input.projectRoot,
        },
      });
    } catch (error) {
      process.stderr.write(`[dynamic-skill-router] ${error.message}\n`);
      finish(null);
      return;
    }
    worker.once('message', (message) => finish(message?.ok ? message.context : null));
    worker.once('error', (error) => { process.stderr.write(`[dynamic-skill-router] ${error.message}\n`); finish(null); });
    worker.once('exit', () => finish(null));
  });
}

// Routing stays read-only; the derived index is rebuilt out of band so the next prompt
// takes the cached path. Throttled, detached, and never awaited.
function refreshIndexInBackground(input) {
  try {
    const now = Date.now();
    let last = 0;
    try { last = Number(JSON.parse(fs.readFileSync(REFRESH_MARKER, 'utf8')).at) || 0; } catch { last = 0; }
    if (now - last < REFRESH_THROTTLE_MS) return;
    fs.mkdirSync(LOG_ROOT, {recursive: true});
    fs.writeFileSync(REFRESH_MARKER, JSON.stringify({at: now, host: routerHost}), 'utf8');
    const args = [CLI, 'refresh-index', '--host', routerHost];
    if (typeof input.projectRoot === 'string' && input.projectRoot) args.push('--project-root', input.projectRoot);
    const child = spawn(process.execPath, args, {detached: true, stdio: 'ignore', windowsHide: true});
    child.on('error', () => {});
    child.unref();
  } catch { /* Index maintenance must never block a prompt. */ }
}

function envelope(context) {
  if (host === 'gemini') return {hookSpecificOutput: {hookEventName: 'BeforeAgent', additionalContext: context}};
  if (host === 'antigravity') return {injectSteps: [{ephemeralMessage: context}]};
  return {hookSpecificOutput: {hookEventName: 'UserPromptSubmit', additionalContext: context}};
}

function emit(output) {
  let done = false;
  const exit = () => { if (!done) { done = true; process.exit(0); } };
  try { process.stdout.write(JSON.stringify(output), exit); } catch { /* Fall through to the guard. */ }
  const guard = setTimeout(exit, 300);
  if (typeof guard.unref === 'function') guard.unref();
}

async function main() {
  if (host === 'cursor') { emit({continue: true}); return; }
  const raw = (await readStdinWithDeadline(STDIN_BUDGET_MS)).trim();
  let input = {};
  try { input = raw ? JSON.parse(raw) : {}; } catch { input = {}; }
  if (host === 'antigravity' && Number(input.invocationNum ?? 0) > 0) { emit({}); return; }
  const directRouteId = typeof input.routeId === 'string' && ROUTE_ID.test(input.routeId) ? input.routeId : '';
  const routeId = directRouteId
    || [input.visibleContext, input.additionalContext, input.context, input.messages]
      .map(routeIdFromVisible).find(Boolean)
    || routeIdFromTranscript(input.transcriptPath);
  if (routeId) {
    emit(envelope(`[动态技能路由器] routeId=${routeId} contractVersion=4\n复用本任务已有路由；新任务或目标实质改变时由主模型判断并调用 route_task。`));
    return;
  }
  const prompt = findPrompt(input) || (routerHost === 'antigravity' ? promptFromTranscript(input.transcriptPath) : '');
  if (!prompt) {
    emit(envelope(fallbackContext('钩子没有取得用户原文。')));
    return;
  }
  const started = Date.now();
  const context = await routeWithinBudget(prompt, input);
  const elapsed = Date.now() - started;
  emit(envelope(context || fallbackContext(`路由未在 ${ROUTE_BUDGET_MS}ms 预算内完成，已降级。`)));
  if (elapsed >= COLD_ROUTE_MS) refreshIndexInBackground(input);
}

main().catch((error) => {
  process.stderr.write(`[dynamic-skill-router] ${error?.message || error}\n`);
  emit(host === 'cursor' ? {continue: true} : envelope(fallbackContext('路由异常，已降级。')));
});
