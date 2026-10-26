#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { GLOBAL_ROOT, SKILLS_ROOT } from './paths.mjs';
import { canonicalHost, getCatalogHosts } from './host-manifest.mjs';

const hosts = getCatalogHosts();
const archiveRoot = path.join(GLOBAL_ROOT, '路由器薄目录归档');
const [mode = 'status', ...requested] = process.argv.slice(2);
const selectedHosts = [...new Set((requested.length ? requested : Object.keys(hosts)).map(canonicalHost))];

function isManagedJunction(itemPath) {
  if (!fs.lstatSync(itemPath).isSymbolicLink()) return false;
  const target = fs.realpathSync(itemPath);
  const relative = path.relative(SKILLS_ROOT, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function ensureHost(name) {
  if (!hosts[name]) throw new Error(`未知宿主: ${name}`);
  fs.mkdirSync(hosts[name], {recursive: true});
  fs.mkdirSync(path.join(archiveRoot, name), {recursive: true});
}

function thin(name) {
  ensureHost(name);
  const root = hosts[name];
  const archive = path.join(archiveRoot, name);
  let moved = 0;
  for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    const source = path.join(root, entry.name);
    if (!isManagedJunction(source)) continue;
    const destination = path.join(archive, entry.name);
    if (fs.existsSync(destination)) throw new Error(`归档目标已存在: ${destination}`);
    fs.renameSync(source, destination);
    moved += 1;
  }
  return {host: name, mode: 'thin', moved, activeEntries: fs.readdirSync(root).length};
}

function restore(name) {
  ensureHost(name);
  const root = hosts[name];
  const archive = path.join(archiveRoot, name);
  let restored = 0;
  for (const entry of fs.readdirSync(archive, {withFileTypes: true})) {
    const source = path.join(archive, entry.name);
    const destination = path.join(root, entry.name);
    if (fs.existsSync(destination)) throw new Error(`恢复目标已存在: ${destination}`);
    fs.renameSync(source, destination);
    restored += 1;
  }
  return {host: name, mode: 'restore', restored, activeEntries: fs.readdirSync(root).length};
}

function status(name) {
  ensureHost(name);
  const root = hosts[name];
  const archive = path.join(archiveRoot, name);
  return {
    host: name,
    activeEntries: fs.readdirSync(root).length,
    archivedManagedSkills: fs.readdirSync(archive).length,
    routerActive: fs.existsSync(path.join(root, 'dynamic-skill-router')),
  };
}

if (!['thin', 'restore', 'status'].includes(mode)) throw new Error('用法: catalog-mode.mjs thin|restore|status [codex claude gemini]');
const result = selectedHosts.map((name) => mode === 'thin' ? thin(name) : mode === 'restore' ? restore(name) : status(name));
console.log(JSON.stringify({archiveRoot, result}, null, 2));
