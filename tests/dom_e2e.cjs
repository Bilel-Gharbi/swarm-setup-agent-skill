// True end-to-end DOM test: jsdom loads the real page from the live server,
// Node's fetch is injected, boot() pulls live /api data, then we click the
// Suggest button exactly like a user and assert visible DOM changes.
// OPTIONAL suite: needs `npm i jsdom` nearby and serve.py running on :7794.
// Not part of run.sh (which stays dependency-free). Run manually:
//   python3 scripts/serve.py --port 7794 --state-dir .swarm &
//   node tests/dom_e2e.cjs
let JSDOM; try { ({ JSDOM } = require('jsdom')); }
catch { console.log('SKIP dom_e2e: jsdom not installed'); process.exit(0); }

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const dom = await JSDOM.fromURL('http://127.0.0.1:7794/', {
    runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = (url, opts) => fetch(new URL(url, 'http://127.0.0.1:7794/'), opts);
    },
  });
  const { window } = dom, document = window.document;
  await new Promise(r => setTimeout(r, 1500)); // boot() fetches

  ok(/live/.test(document.getElementById('livestat').textContent),
    'boot loaded live data: ' + document.getElementById('livestat').textContent.slice(0, 90));
  ok(document.querySelectorAll('select.agent').length >= 6,
    `agent selects injected (${document.querySelectorAll('select.agent').length})`);

  document.getElementById('brief').value =
    'A delivery platform: React dashboard, Express API with Postgres, React Native courier app. MVP, small budget.';
  document.querySelector('button[onclick="suggestTeam()"]').click();
  await new Promise(r => setTimeout(r, 300));

  const note = document.getElementById('suggestnote').textContent;
  ok(/backend, frontend, mobile/.test(note), 'suggest note lists all 3 domains: ' + note.split('\n')[0]);
  ok(/budget/.test(note), 'budget acknowledged in note');

  const domains = [...document.querySelectorAll('.domain .dname')].map(i => i.value);
  ok(JSON.stringify(domains) === '["backend","frontend","mobile"]', 'domain cards rebuilt: ' + JSON.stringify(domains));
  ok(document.querySelector('[data-role=qa_mobile] .enabled').value === 'yes', 'QA mobile auto-enabled');
  ok(document.querySelector('[data-role=qa_web] .enabled').value === 'yes', 'QA web auto-enabled');

  const brainModel = document.querySelector('[data-role=brain] select.model').value;
  const models = await (await fetch('http://127.0.0.1:7794/api/models')).json();
  const flatAvail = (models.models||[]).some(m => m.available !== false && /glm|qwen/.test(m.route));
  ok(flatAvail ? /glm|qwen/.test(brainModel) : /no flat-rate route is available/.test(note),
    flatAvail ? 'budget brief -> flat-rate brain: ' + brainModel
              : 'no flat route available -> brain stays strong (' + brainModel + ') and note explains why');

  const implAgents = [...document.querySelectorAll('.domain select.agent')].map(s => s.value);
  ok(implAgents.length === 3 && implAgents.every(a => a === 'jcode'),
    'impl agents -> jcode (native swarm): ' + JSON.stringify(implAgents));

  document.querySelectorAll('.domain select.agent')[0].value = 'pi';
  const answers = window.collect();
  ok(answers.roles.implementers[0].agent === 'pi', 'manual agent override survives into answers');
  ok(String(answers.brief).includes('delivery platform'), 'brief travels in answers');
  ok(answers.roles.implementers.length === 3, '3 implementers in answers');
  ok(answers.roles.brain.agent !== undefined, 'brain carries an agent field: ' + answers.roles.brain.agent);

  // ---- spec paste + full submit roundtrip (covers the upload/paste feature) ----
  const ta = document.getElementById('spectext');
  ta.value = '# My Spec\n\nBuild a thing.';
  ta.dispatchEvent(new window.Event('input'));
  const on = document.querySelector('#specmode .chip.on');
  ok(on && on.dataset.v === 'ingest', 'pasting spec flips mode chip to ingest');
  const a2 = window.collect();
  ok(a2.spec.inline_text === '# My Spec\n\nBuild a thing.', 'inline spec text in answers');
  const res = await fetch('http://127.0.0.1:7794/api/answers', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a2) });
  ok((await res.json()).ok === true, 'POST /api/answers accepts the new schema');

  console.log(fails ? `\n${fails} DOM e2e test(s) failed` : '\nall DOM e2e tests passed');
  process.exit(fails ? 1 : 0);
})();
