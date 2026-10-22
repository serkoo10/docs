// Вызывается post-commit-хуком проекта: план → issues, доки → сайт, коммит и пуш репозитория сайта.
// Пропускает коммиты, не трогавшие docs/ и README.md. Параллельные запуски ждут друг друга через lock-каталог.
import {execFileSync} from 'node:child_process';
import {mkdirSync, rmSync} from 'node:fs';
import {findProject, resolvePath, SITE_ROOT} from './projects.mjs';
import {syncAll} from './sync.mjs';
import {syncTasks} from './tasks.mjs';

const project = findProject(process.argv[2]);
const projectPath = resolvePath(project.path);
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', env: {...process.env, DOCS_PUBLISH: '1'}}).trim();
const log = (message) => console.log(`${new Date().toISOString()} ${project.name}: ${message}`);

const touchedDocs = git(projectPath, 'diff-tree', '--root', '--no-commit-id', '--name-only', '-r', 'HEAD')
  .split('\n')
  .some((file) => file === 'README.md' || file.startsWith('docs/'));
if (!touchedDocs) process.exit(0);

const LOCK = `${SITE_ROOT}.publish.lock`;
const acquireLock = () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      mkdirSync(LOCK);
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
  }
  throw new Error(`не дождался lock ${LOCK}`);
};

acquireLock();
try {
  if (project.repo && syncTasks(project)) {
    git(projectPath, 'add', 'docs/plan.md');
    git(projectPath, 'commit', '-q', '-o', 'docs/plan.md', '-m', 'docs: link plan items to issues');
    log('план связан с issues, коммит в проекте');
  }
  syncAll();
  git(SITE_ROOT, 'add', '-A', 'docs');
  if (git(SITE_ROOT, 'status', '--porcelain', 'docs') === '') {
    log('на сайте без изменений');
  } else {
    git(SITE_ROOT, 'commit', '-q', '-m', `sync: ${project.name}`);
    git(SITE_ROOT, 'push', '-q');
    log('опубликовано');
  }
} catch (error) {
  log(`ошибка: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(LOCK, {recursive: true, force: true});
}
