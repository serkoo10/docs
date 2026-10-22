import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';

export const SITE_ROOT = new URL('../', import.meta.url).pathname;

export const projects = JSON.parse(readFileSync(`${SITE_ROOT}projects.json`, 'utf8'));

export const resolvePath = (path) => path.replace(/^~/, homedir());

export const findProject = (name) => {
  const project = projects.find((p) => p.name === name);
  if (project) return project;
  console.error(`Проект не найден: ${name ?? '(не указан)'}. Известные: ${projects.map((p) => p.name).join(', ')}`);
  process.exit(1);
};
