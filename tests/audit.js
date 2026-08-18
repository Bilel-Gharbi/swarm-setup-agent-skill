// Structural audit of the swarm-setup assets: every class/id used in markup has
// CSS or JS backing it, no dead rules, no dangling getElementById targets.
const fs = require('fs');
const DIR = require('path').resolve(__dirname, '..');
let fails = 0;
const t = (name, ok, extra) => {
  if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && extra ? '  -> ' + extra : ''));
};

for (const file of ['dashboard.html', 'interview.html']) {
  const html = fs.readFileSync(`${DIR}/assets/${file}`, 'utf8');
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  const js = (html.match(/<script>([\s\S]*?)<\/script>/) || [, ''])[1];
  console.log(`\n--- ${file} ---`);

  // 1. Every class used in static markup must have a CSS rule or be JS-driven.
  const bodyHtml = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script>[\s\S]*?<\/script>/, '');
  const usedClasses = new Set();
  for (const m of bodyHtml.matchAll(/class="([^"{}]+)"/g))
    m[1].split(/\s+/).filter(Boolean).forEach((c) => usedClasses.add(c));
  const missing = [...usedClasses].filter((c) => {
    const re = new RegExp('\\.' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])');
    return !re.test(css) && !re.test(js) && !js.includes(`'${c}'`) && !js.includes(`"${c}"`);
  });
  t('every markup class has CSS backing', missing.length === 0, missing.join(', '));

  // 2. Every getElementById target must exist in markup or be created by JS.
  const ids = new Set();
  for (const m of bodyHtml.matchAll(/id="([^"]+)"/g)) ids.add(m[1]);
  const looked = new Set();
  for (const m of js.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) looked.add(m[1]);
  const dangling = [...looked].filter((id) => !ids.has(id) && !js.includes(`id="${id}"`) && !js.includes(`id=\\"${id}\\"`));
  t('no dangling getElementById targets', dangling.length === 0, dangling.join(', '));

  // 3. Balanced divs in the body (catches broken view nesting).
  const opens = (bodyHtml.match(/<div\b/g) || []).length;
  const closes = (bodyHtml.match(/<\/div>/g) || []).length;
  t('div tags balanced', opens === closes, `${opens} open vs ${closes} close`);

  // 4. No duplicate id attributes.
  const allIds = [...bodyHtml.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const dupes = allIds.filter((v, i) => allIds.indexOf(v) !== i);
  t('no duplicate ids', dupes.length === 0, dupes.join(', '));

  // 5. No duplicate CSS selector blocks for the same simple selector.
  const sels = [...css.matchAll(/^\s*(\.[\w-]+)\{/gm)].map((m) => m[1]);
  const dupSels = sels.filter((v, i) => sels.indexOf(v) !== i);
  t('no duplicated CSS rule blocks', dupSels.length === 0, dupSels.join(', '));

  // 6. Functions referenced from inline handlers must be defined.
  const handlers = new Set();
  for (const m of bodyHtml.matchAll(/on\w+="(\w+)\(/g)) handlers.add(m[1]);
  const undef = [...handlers].filter((f) => !new RegExp(`function\\s+${f}\\b|${f}\\s*=\\s*(async\\s*)?\\(|const\\s+${f}\\s*=`).test(js));
  t('inline handlers are defined', undef.length === 0, undef.join(', '));
}

// 7. dashboard-specific: view/nav wiring must correspond 1:1.
const dash = fs.readFileSync(`${DIR}/assets/dashboard.html`, 'utf8');
const navs = [...dash.matchAll(/data-nav="([a-z]+)"/g)].map((m) => m[1]);
const views = [...dash.matchAll(/id="v-([a-z]+)"/g)].map((m) => m[1]);
console.log('\n--- nav <-> view wiring ---');
t('every nav item has a view', navs.every((n) => views.includes(n)), navs.filter((n) => !views.includes(n)).join(', '));
t('every view has a nav item', views.every((v) => navs.includes(v)), views.filter((v) => !navs.includes(v)).join(', '));
t('nav badge ids referenced in render', ['nbBoard', 'nbGraph', 'nbLog'].every((b) => dash.includes(b)));

// 8. Filter bar must live OUTSIDE the board view (shared across views).
const boardStart = dash.indexOf('id="v-board"');
const boardEnd = dash.indexOf('/v-board');
const filterPos = dash.indexOf('id="filters"');
t('filter bar shared, not trapped in board view', !(filterPos > boardStart && filterPos < boardEnd));

// 9. serve.py endpoints referenced by the pages must exist.
const py = fs.readFileSync(`${DIR}/scripts/serve.py`, 'utf8');
const fetched = new Set();
for (const m of dash.matchAll(/fetch\('(\/api\/[a-z]+)'/g)) fetched.add(m[1]);
const iv = fs.readFileSync(`${DIR}/assets/interview.html`, 'utf8');
for (const m of iv.matchAll(/fetch\('(\/api\/[a-z]+)'/g)) fetched.add(m[1]);
console.log('\n--- page <-> server contract ---');
const noRoute = [...fetched].filter((p) => !py.includes(`"${p}"`));
t('every fetched endpoint exists in serve.py', noRoute.length === 0, noRoute.join(', '));
t('documented endpoints match code', ['/api/quota', '/api/status', '/api/models', '/api/skills', '/api/answers'].every((p) => py.includes(p)));

console.log(fails ? `\n${fails} FAILURE(S)` : '\nstructural audit clean');
process.exit(fails ? 1 : 0);
