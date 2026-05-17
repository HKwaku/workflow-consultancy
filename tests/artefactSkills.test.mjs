import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARTEFACT_SKILLS, RAW_SKILL, getSkill, skillIds, skillCatalogue, validateForType,
} from '../lib/agents/artefacts/skills.js';
import { parseMermaidGantt } from '../lib/artefacts/mermaidGantt.js';

test('registry shape: every skill is well-formed', () => {
  const RENDERABLE = new Set(['markdown', 'code', 'table', 'json', 'csv', 'mermaid', 'gantt', 'pptx', 'docx', 'xlsx', 'text', 'html', 'svg']);
  for (const [id, s] of Object.entries(ARTEFACT_SKILLS)) {
    assert.equal(s.id, id, `id matches key for ${id}`);
    assert.ok(typeof s.label === 'string' && s.label, `${id} has label`);
    assert.ok(typeof s.type === 'string' && RENDERABLE.has(s.type), `${id} type renderable (${s.type})`);
    assert.ok(typeof s.whenToUse === 'string' && s.whenToUse, `${id} has whenToUse`);
    assert.equal(typeof s.validate, 'function', `${id} has validate()`);
    if (s.office) {
      assert.ok(['pptx', 'docx', 'xlsx'].includes(s.format), `${id} office format valid`);
    }
  }
});

test('skillIds / catalogue include raw and every registry id', () => {
  const ids = skillIds();
  assert.ok(ids.includes(RAW_SKILL), 'includes raw');
  assert.equal(ids.length, Object.keys(ARTEFACT_SKILLS).length + 1, 'registry + raw');
  for (const id of Object.keys(ARTEFACT_SKILLS)) assert.ok(ids.includes(id), `enum has ${id}`);
  const cat = skillCatalogue();
  assert.ok(
    cat.includes('gantt') && cat.includes(getSkill('gantt').whenToUse) && cat.includes(';'),
    'catalogue digests each skill as "id — whenToUse", joined by ;',
  );
  assert.equal(getSkill('gantt')?.id, 'gantt');
  assert.equal(getSkill('does_not_exist'), null);
});

test('gantt-type skills share the structured-output schema', () => {
  const ganttSkills = Object.values(ARTEFACT_SKILLS).filter((s) => s.type === 'gantt');
  assert.ok(ganttSkills.length >= 3, 'gantt, hundred_day_plan, automation_roadmap');
  for (const s of ganttSkills) {
    assert.ok(s.jsonSchema && s.jsonSchema.type === 'object', `${s.id} ships jsonSchema`);
    assert.equal(s.jsonSchema.additionalProperties, false, 'schema closed');
  }
  // all gantt skills reference the SAME schema object (factored constant)
  assert.equal(ganttSkills[0].jsonSchema, ganttSkills[1].jsonSchema);
});

test('okGanttData: accepts a real plan, rejects weak ones', () => {
  const v = ARTEFACT_SKILLS.gantt.validate;
  const good = {
    title: 'Plan',
    sections: [
      { name: 'A', tasks: [
        { id: 'a1', name: 'Kick off', start: '2026-06-01', duration: 5 },
        { id: 'a2', name: 'Do thing', after: ['a1'], duration: 5 },
        { id: 'm1', name: 'A done', after: ['a2'], milestone: true }] },
      { name: 'B', tasks: [
        { id: 'b1', name: 'Next', after: ['a2'], duration: 5 },
        { id: 'b2', name: 'More', after: ['b1'], duration: 5 },
        { id: 'm2', name: 'B done', after: ['b2'], milestone: true }] },
      { name: 'C', tasks: [
        { id: 'c1', name: 'Wrap', after: ['b2'], duration: 5 },
        { id: 'm3', name: 'Done', after: ['c1'], milestone: true }] },
    ],
  };
  assert.equal(v(JSON.stringify(good)).ok, true, 'valid plan passes');
  assert.equal(v('not json').ok, false, 'non-JSON fails');
  assert.equal(v(JSON.stringify({ title: 'x', sections: [good.sections[0]] })).ok, false, '<3 sections fails');
  const noDeps = JSON.parse(JSON.stringify(good));
  noDeps.sections.forEach((s) => s.tasks.forEach((t) => { delete t.after; if (!t.milestone) t.start = '2026-06-01'; }));
  assert.equal(v(JSON.stringify(noDeps)).ok, false, 'no dependencies fails');
  const badRef = JSON.parse(JSON.stringify(good));
  badRef.sections[0].tasks[1].after = ['nope'];
  assert.equal(v(JSON.stringify(badRef)).ok, false, 'unknown dep id fails');
});

test('type validators via validateForType', () => {
  // table: array of row objects
  assert.equal(validateForType('table', '[{"a":1},{"a":2}]').ok, true);
  assert.equal(validateForType('table', 'nope').ok, false);
  // json
  assert.equal(validateForType('json', '{"k":1}').ok, true);
  assert.equal(validateForType('json', '{bad').ok, false);
  // csv: header + >=1 row
  assert.equal(validateForType('csv', 'a,b\n1,2').ok, true);
  assert.equal(validateForType('csv', 'justoneline').ok, false);
  // mermaid: must start with a diagram keyword; fences stripped
  assert.equal(validateForType('mermaid', 'flowchart TD\n A-->B').ok, true);
  assert.equal(validateForType('mermaid', '```mermaid\nsequenceDiagram\n A->>B: hi\n```').ok, true);
  assert.equal(validateForType('mermaid', 'not a diagram').ok, false);
  // text / default: non-empty
  assert.equal(validateForType('markdown', '# Hi').ok, true);
  assert.equal(validateForType('markdown', '   ').ok, false);
});

test('parseMermaidGantt: mermaid gantt → structured plan', () => {
  const src = `gantt
    dateFormat YYYY-MM-DD
    title Roadmap
    section Discovery
    Map it :active, d1, 2026-06-01, 10d
    Quantify :crit, d2, after d1, 1w
    Signed off :milestone, m1, after d2, 0d
    section Build
    Build :b1, after d2, 12d`;
  const p = parseMermaidGantt(src);
  assert.ok(p && p.title === 'Roadmap');
  assert.equal(p.sections.length, 2);
  const tasks = p.sections.flatMap((s) => s.tasks);
  const ids = new Set(tasks.map((t) => t.id));
  assert.ok(ids.has('d1') && ids.has('d2') && ids.has('m1') && ids.has('b1'));
  const d2 = tasks.find((t) => t.id === 'd2');
  assert.deepEqual(d2.after, ['d1']);
  assert.equal(d2.crit, true);
  assert.equal(d2.duration, 7, '1w → 7 days');
  assert.equal(tasks.find((t) => t.id === 'm1').milestone, true);
  assert.equal(tasks.find((t) => t.id === 'd1').start, '2026-06-01');
});

test('parseMermaidGantt: non-gantt / empty → null', () => {
  assert.equal(parseMermaidGantt('flowchart TD\n A-->B'), null);
  assert.equal(parseMermaidGantt(''), null);
  assert.equal(parseMermaidGantt('gantt\n  dateFormat YYYY-MM-DD'), null, 'no tasks → null');
});
