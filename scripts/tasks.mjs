// План проекта (docs/plan.md) как доска задач поверх GitHub Issues.
// Строка `- [ ] текст` без ссылки на issue → создаётся issue, ссылка дописывается в строку.
// Строка со ссылкой → галочка выставляется по состоянию issue (закрыт — [x]).
import {readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {findProject, resolvePath} from './projects.mjs';

const project = findProject(process.argv[2]);
if (!project.repo) {
  console.error(`У проекта ${project.name} не задан repo в projects.json`);
  process.exit(1);
}

const planPath = `${resolvePath(project.path)}/docs/plan.md`;
const gh = (...args) => execFileSync('gh', args, {encoding: 'utf8'}).trim();

const issueStates = new Map(
  JSON.parse(gh('issue', 'list', '-R', project.repo, '--state', 'all', '--limit', '1000', '--json', 'number,state'))
    .map((issue) => [issue.number, issue.state]),
);

const TASK = /^(\s*)- \[( |x)\] (.*?)(?: \(\[#(\d+)\]\([^)]*\)\))?\s*$/;
const issueLink = (number) => `([#${number}](https://github.com/${project.repo}/issues/${number}))`;

let section = '';
let changed = false;

const syncLine = (line) => {
  if (line.startsWith('#')) {
    section = line.replace(/^#+\s*/, '');
    return line;
  }
  const match = TASK.exec(line);
  if (!match) return line;
  const [, indent, mark, text, number] = match;

  if (number === undefined) {
    const url = gh('issue', 'create', '-R', project.repo, '-t', text, '-b', `Раздел плана: ${section}`);
    const created = Number(url.split('/').at(-1));
    console.log(`+ #${created} ${text}`);
    changed = true;
    return `${indent}- [ ] ${text} ${issueLink(created)}`;
  }

  const state = issueStates.get(Number(number));
  if (state === undefined) return line;
  const next = state === 'CLOSED' ? 'x' : ' ';
  if (next !== mark) {
    console.log(`${next === 'x' ? '✓' : '○'} #${number} ${text}`);
    changed = true;
  }
  return `${indent}- [${next}] ${text} ${issueLink(number)}`;
};

const out = readFileSync(planPath, 'utf8').split('\n').map(syncLine);
if (changed) writeFileSync(planPath, out.join('\n'));
else console.log('План и issues совпадают');
