// Test the quota panel math and the interview recommendation engine.
const fs = require('fs');
const DIR = require('path').resolve(__dirname, '..');
let fails = 0;
const t = (name, ok, extra) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && extra ? '  -> ' + extra : '')); };

// ---------- quota panel ----------
const dash = fs.readFileSync(`${DIR}/assets/dashboard.html`, 'utf8');
const djs = dash.match(/<script>([\s\S]*)<\/script>/)[1];
const grab = (src, re) => { const m = src.match(re); if (!m) throw new Error('extract failed: ' + re); return m[0]; };

let out = '';
const stubEl = () => ({ innerHTML: '', classList: { toggle() {}, remove() {}, add() {} }, querySelector: () => null, remove() {} });
global.document = { getElementById: (id) => (id === 'quota' ? { set innerHTML(v) { out = v; }, get innerHTML() { return out; } } : stubEl()) };
global.esc = (s) => String(s ?? '');
global.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });

eval([
  grab(djs, /const fmtTok=.*?;/),
  grab(djs, /const provOf=[\s\S]*?'other';/),
  grab(djs, /const H5=.*?;/),
  grab(djs, /function renderQuota\(\)\{[\s\S]*?\n\}/),
].join('\n') + '\nglobal.renderQuota=renderQuota;global.provOf=provOf;global.fmtTok=fmtTok;');

const now = Date.now();
const iso = (minsAgo) => new Date(now - minsAgo * 60000).toISOString();
global.QUOTA = { providers: {
  anthropic: { metered: true, cap_5h: 1000000, cap_week: 5000000, plan: 'Claude $100 plan' },
  zai: { metered: false, plan: 'GLM subscription' },
} };
global.cur = { usage: [
  { model: 'claude-opus-5', session: 'sA', tokens: 800000, ts: iso(60) },    // in 5h + week
  { model: 'claude-opus-5', session: 'sB', tokens: 300000, ts: iso(60 * 20) }, // week only
  { model: 'claude-opus-5', session: 'sC', tokens: 999999, ts: iso(60 * 24 * 9) }, // outside week
  { model: 'zai:glm-5.2', session: 'sD', tokens: 250000, ts: iso(30) },
] };
renderQuota();

console.log('--- quota panel ---');
t('anthropic 5h usage counted (800k)', out.includes('800.0k / 1.0M'), out.match(/800[^<]*/)?.[0]);
t('5h remaining shown (200k left)', out.includes('200.0k left'));
t('weekly excludes >7d entry (1.1M not 2.1M)', out.includes('1.1M / 5.0M'));
t('at 80% of cap the bar goes hot', out.includes('qbar hot'));
t('flat-rate shows infinity included', out.includes('\u221e included'));
t('flat-rate shows real 5h number, not blank', /<b>250\.0k<\/b> in 5h/.test(out));
t('no always-empty expression regression', !out.includes('<b>used 5h</b>'));
t('per-session rows rendered', out.includes('session sA') && out.includes('session sD'));
t('cap edit buttons present', out.includes("editCap('anthropic','cap_5h')"));
t('no NaN / undefined in quota markup', !out.includes('NaN') && !out.includes('undefined'));

// over-cap case
global.QUOTA.providers.anthropic.cap_5h = 500000;
renderQuota();
t('over cap renders as over, 0 left', out.includes('qbar over') && out.includes('0 left'));

// no caps set at all
global.QUOTA.providers.anthropic.cap_5h = null;
global.QUOTA.providers.anthropic.cap_week = null;
renderQuota();
t('null caps render as unlimited', (out.match(/\u221e/g) || []).length >= 2);

// provider routing
console.log('--- provider mapping ---');
t('claude-opus-5 -> anthropic', provOf('claude-opus-5') === 'anthropic');
t('qwen3-coder-plus -> alibaba', provOf('qwen3-coder-plus') === 'alibaba');
t('zai:glm-5.2 -> zai', provOf('zai:glm-5.2') === 'zai');
t('kimi-k2.5 -> kimi', provOf('kimi-k2.5') === 'kimi');
t('claude-fable-5 -> anthropic', provOf('claude-fable-5') === 'anthropic');

// ---------- interview recommendation engine ----------
const iv = fs.readFileSync(`${DIR}/assets/interview.html`, 'utf8');
const ijs = iv.match(/<script>([\s\S]*)<\/script>/)[1];
eval([
  grab(ijs, /const RECS=\{[\s\S]*?\n\};/),
  grab(ijs, /const fam=.*?;/),
  grab(ijs, /function pick\(role,avoidFam\)\{[\s\S]*?\n\}/),
].join('\n') + '\nglobal.pick=pick;global.fam=fam;');

console.log('--- recommendation engine ---');
global.MODELS = [
  { route: 'zai:glm-5.2', available: true },
  { route: 'claude-opus-5', available: true },
  { route: 'qwen3-coder-plus', available: true },
  { route: 'qwen3.8-max', available: true },
  { route: 'gpt-5.5', available: false, login: 'jcode login openai' },
];
t('implementer prefers flat-rate glm', pick('impl') === 'zai:glm-5.2');
t('reviewer avoiding glm family picks opus', pick('reviewer', 'glm') === 'claude-opus-5');
t('reviewer avoiding anthropic falls to glm', pick('reviewer', 'anthropic') === 'zai:glm-5.2');
t('never recommends unavailable route', !['brain', 'impl', 'reviewer', 'tester', 'escalate'].some((r) => pick(r) === 'gpt-5.5'));
t('escalation picks strongest (opus)', pick('escalate') === 'claude-opus-5');

// Claude-only environment must still work
global.MODELS = [{ route: 'claude-opus-5', available: true }, { route: 'claude-sonnet-5', available: true }];
t('claude-only env: impl still resolves', pick('impl') === 'claude-sonnet-5');
t('claude-only env: reviewer avoiding anthropic degrades gracefully', typeof pick('reviewer', 'anthropic') === 'string');

// Qwen-only environment (user's cheapest setup)
global.MODELS = [{ route: 'qwen3-coder-plus', available: true }, { route: 'qwen3.8-max', available: true }];
t('qwen-only env: impl picks coder', pick('impl') === 'qwen3-coder-plus');
t('qwen-only env: brain picks max', pick('brain') === 'qwen3.8-max');

// empty model list must not throw
global.MODELS = [];
t('empty model list returns null, no throw', pick('impl') === null);

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall quota + recommendation tests passed');
process.exit(fails ? 1 : 0);
