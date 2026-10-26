import fs from 'node:fs';
import path from 'node:path';
import { ROUTER_ROOT } from './paths.mjs';

const manifestPath = path.join(ROUTER_ROOT, 'config', 'host-manifest.json');
let cache;

export function loadHostManifest() {
  if (!cache) cache = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return cache;
}

export function canonicalHost(name = 'generic') {
  const requested = String(name || 'generic').toLowerCase();
  const hosts = loadHostManifest().hosts;
  if (hosts[requested]) return requested;
  for (const [id, profile] of Object.entries(hosts)) {
    if ((profile.aliases || []).includes(requested)) return id;
  }
  return 'generic';
}

export function getHostProfile(name = 'generic') {
  const id = canonicalHost(name);
  return {id, ...loadHostManifest().hosts[id]};
}

export function getManagedSkillHosts() {
  return Object.fromEntries(Object.entries(loadHostManifest().hosts)
    .filter(([, profile]) => profile.syncManaged && profile.skillRoot)
    .map(([id, profile]) => [id, profile.skillRoot]));
}

export function getCatalogHosts() {
  return Object.fromEntries(Object.entries(loadHostManifest().hosts)
    .filter(([, profile]) => profile.catalogManaged && profile.skillRoot)
    .map(([id, profile]) => [id, profile.skillRoot]));
}
