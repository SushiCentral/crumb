import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecentProjects, recordProject } from '../src/lib/recent-projects.ts';

test('records directories most-recent-first and moves reopened projects to the top', () => {
  let projects = recordProject([], '/work/crumb', 10);
  projects = recordProject(projects, '/work/folio', 20);
  projects = recordProject(projects, '/work/crumb/', 30);
  assert.deepEqual(projects, [
    { path: '/work/crumb', name: 'crumb', lastOpened: 30 },
    { path: '/work/folio', name: 'folio', lastOpened: 20 },
  ]);
});

test('handles Windows paths and keeps a bounded history', () => {
  assert.deepEqual(recordProject([], 'C:\\work\\crumb\\', 1), [{ path: 'C:\\work\\crumb', name: 'crumb', lastOpened: 1 }]);
  let projects = [];
  for (let i = 0; i < 20; i++) projects = recordProject(projects, `/work/project-${i}`, i);
  assert.equal(projects.length, 15);
  assert.equal(projects[0].name, 'project-19');
  assert.equal(recordProject([], '/', 0)[0].path, '/');
  assert.equal(recordProject([], 'C:\\', 0)[0].path, 'C:\\');
});

test('restores valid stored projects and tolerates malformed storage', () => {
  for (const raw of [null, 'broken json', '{}', '[null,42,{"path":"/work"}]']) assert.deepEqual(parseRecentProjects(raw), []);
  const projects = [{ path: '/work/crumb', name: 'crumb', lastOpened: 1 }];
  assert.deepEqual(parseRecentProjects(JSON.stringify(projects)), projects);
});
