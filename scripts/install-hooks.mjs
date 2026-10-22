// Ставит post-commit-хук в каждый проект из projects.json, у которого есть .git.
// Хук запускает publish.mjs в фоне, чтобы не задерживать коммит; вывод в .publish.log.
import {chmodSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {projects, resolvePath, SITE_ROOT} from './projects.mjs';

const MARKER = '# docs-publish';

for (const project of projects) {
  const hooksDir = `${resolvePath(project.path)}/.git/hooks`;
  if (!existsSync(hooksDir)) {
    console.log(`${project.name}: нет .git, хук не ставлю`);
    continue;
  }
  const hook = `${hooksDir}/post-commit`;
  if (existsSync(hook) && !readFileSync(hook, 'utf8').includes(MARKER)) {
    console.log(`${project.name}: уже есть чужой post-commit, пропускаю`);
    continue;
  }
  writeFileSync(
    hook,
    `#!/bin/sh
${MARKER}: публикация доков на сайт, ставится командой pnpm hooks в ${SITE_ROOT}
[ -n "$DOCS_PUBLISH" ] && exit 0
nohup node "${SITE_ROOT}scripts/publish.mjs" "${project.name}" >> "${SITE_ROOT}.publish.log" 2>&1 &
`,
  );
  chmodSync(hook, 0o755);
  console.log(`${project.name}: хук поставлен`);
}
