// Переносит docs/**/*.md и README.md каждого проекта из projects.json в docs/<проект>/ сайта.
// Папка проекта на сайте пересоздаётся целиком, чтобы удаления тоже доезжали.
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {projects, resolvePath, SITE_ROOT} from './projects.mjs';

const DOCS = `${SITE_ROOT}docs/`;

const copyMarkdownTree = (from, to) => {
  for (const entry of readdirSync(from, {withFileTypes: true})) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copyMarkdownTree(src, dst);
    else if (entry.name.endsWith('.md')) {
      mkdirSync(dirname(dst), {recursive: true});
      copyFileSync(src, dst);
    }
  }
};

// README лежит на уровень выше docs/: ссылки в docs/ ведут на соседние страницы,
// остальные относительные ссылки — в репозиторий на GitHub, если он есть
const rewriteReadmeLinks = (text, repo) =>
  text.replace(/\]\((?!https?:|#|mailto:)(?:\.\/)?([^)\s]+)\)/g, (match, target) => {
    if (target.startsWith('docs/')) return `](${target.slice('docs/'.length)})`;
    return repo ? `](https://github.com/${repo}/blob/main/${target})` : match;
  });

const syncProject = (project, position) => {
  const src = resolvePath(project.path);
  const dst = `${DOCS}${project.name}/`;
  rmSync(dst, {recursive: true, force: true});
  mkdirSync(dst, {recursive: true});
  writeFileSync(`${dst}_category_.json`, JSON.stringify({label: project.name, position}, null, 2) + '\n');

  const readme = `${src}/README.md`;
  if (existsSync(readme)) {
    writeFileSync(`${dst}index.md`, rewriteReadmeLinks(readFileSync(readme, 'utf8'), project.repo));
  }

  const docs = `${src}/docs`;
  if (existsSync(docs)) copyMarkdownTree(docs, dst);

  const copied = readdirSync(dst, {recursive: true}).filter((f) => f.endsWith('.md'));
  console.log(`${project.name}: ${copied.length} файлов`);
  return copied.length;
};

const writeIndex = () => {
  const list = projects
    .map((p) => `- [${p.name}](./${p.name}/index.md) — ${p.description}`)
    .join('\n');
  writeFileSync(
    `${DOCS}index.md`,
    `---
slug: /
title: Документация
sidebar_position: 0
---

# Документация

Документация по проектам. Сайт — источник истины: если код и страница здесь расходятся,
одно из них ошибка.

Страницы собираются из \`README.md\` и \`docs/\` каждого проекта командой \`pnpm sync\`;
список проектов и их пути лежат в \`projects.json\`. У каждого проекта своя папка.
План проекта живёт в \`docs/plan.md\`, задачи из него превращаются в GitHub Issues
командой \`pnpm tasks <проект>\`.

## Проекты

${list}
`,
  );
};

export const syncAll = () => {
  projects.forEach((project, i) => syncProject(project, i + 1));
  writeIndex();
};

if (process.argv[1] === fileURLToPath(import.meta.url)) syncAll();
