import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROUTER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Portable defaults contain only original sample skills. No personal library is bundled.
export const GLOBAL_ROOT = path.resolve(process.env.SKILL_ROUTER_DATA_ROOT || path.join(ROUTER_ROOT, 'examples', 'data'));
export const SKILLS_ROOT = path.join(GLOBAL_ROOT, 'skills');
export const REGISTRY_PATH = path.join(GLOBAL_ROOT, '技能注册表', 'skills.json');
export const LOG_ROOT = path.resolve(process.env.SKILL_ROUTER_LOG_ROOT || path.join(ROUTER_ROOT, '.runtime', 'logs'));
export const CACHE_PATH = path.join(LOG_ROOT, 'last-route.json');
