// Behavioral test of the interview's zero-token team-suggestion engine:
// domain detection from a brief, budget tilt, and agent-fit scoring.
// Extracts the real functions from interview.html and runs them.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../assets/interview.html'), 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// --- DOMAIN_SIGNALS regexes ---
const sig = js.match(/const DOMAIN_SIGNALS=\{[\s\S]*?\n\};/)[0];
const DOMAIN_SIGNALS = eval('(' + sig.replace('const DOMAIN_SIGNALS=', '').replace(/;$/, '') + ')');
const detect = brief => Object.entries(DOMAIN_SIGNALS).filter(([, s]) => s.re.test(brief)).map(([d]) => d);

console.log('--- domain detection ---');
ok(JSON.stringify(detect('Express API with Postgres and a React dashboard')) === '["backend","frontend"]',
  'api+dashboard brief -> backend, frontend');
ok(detect('React Native courier app with FastAPI backend').includes('mobile'),
  'react native brief -> mobile detected');
ok(detect('a flutter app').join() === 'mobile', 'flutter-only brief -> mobile only');
ok(detect('vague words with no stack').length === 0, 'stackless brief -> no domains (UI falls back to defaults)');
ok(detect('a nextjs landing page').join() === 'frontend', 'nextjs -> frontend, not backend');

console.log('--- agent fit ---');
const af = js.match(/function agentsForRoute[\s\S]*?\n\}/)[0];
const ba = js.match(/function bestAgent[\s\S]*?\n\}/)[0];
global.HOSTSDATA = [{ id: 'claude' }, { id: 'pi' }, { id: 'opencode' }];
eval(af); eval(ba);
ok(bestAgent('claude-opus-5') === 'claude', 'anthropic route on claude-only-native env -> claude');
ok(bestAgent('zai:glm-5.2') === 'pi', 'non-anthropic route -> cross-provider CLI (pi), not claude');
global.HOSTSDATA = [{ id: 'jcode' }, { id: 'claude' }];
ok(bestAgent('zai:glm-5.2') === 'jcode', 'jcode wins when installed (native swarm)');
global.HOSTSDATA = [];
ok(bestAgent('anything') === null, 'no hosts -> null, no throw');

console.log('--- budget regex ---');
const cheapRe = /\b(small budget|cheap|low cost|free|budget|side project|mvp)\b/i;
ok(cheapRe.test('MVP in 3 weeks, small budget'), 'budget brief detected');
ok(!cheapRe.test('enterprise deployment with SLAs'), 'non-budget brief not flagged');

console.log('--- form contract ---');
ok(/id="brief"/.test(html) && /id="specdrop"/.test(html) && /id="spectext"/.test(html),
  'brief + spec inputs present');
ok(/suggestTeam\(\)/.test(html), 'suggest button wired');
ok(/inline_text:SPEC\.text/.test(js), 'submitted answers carry inline spec text');
ok(/agent:card\.querySelector\('select\.agent'\)/.test(js), 'submitted answers carry per-role agent');

console.log(fails ? `\n${fails} suggestion test(s) failed` : '\nall suggestion tests passed');
process.exit(fails ? 1 : 0);
