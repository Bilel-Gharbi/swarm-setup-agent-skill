// Verify renderGraph() produces correct SVG using a minimal DOM stub.
const fs = require('fs');
const html = fs.readFileSync(require('path').resolve(__dirname, '../assets/dashboard.html'), 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

// Pull the pieces renderGraph depends on.
const grab = (re) => js.match(re)[0];
const parts = [
  grab(/const PHASES=\[[\s\S]*?\];/),
  grab(/const STATE2COL=[\s\S]*?\|\|"backlog"\);/),
  grab(/const ACTIVE=\[.*?\];/),
  grab(/const fmtTok=.*?;/),
  grab(/function layout\(nodes\)\{[\s\S]*?\n\}/),
  grab(/function renderGraph\(st\)\{[\s\S]*?\n\}/),
].join('\n');

// Minimal DOM stub: only what renderGraph touches.
function mkEl(id) {
  return {
    id, innerHTML: '', _attrs: {}, _children: [],
    setAttribute(k, v) { this._attrs[k] = v; },
    querySelector() { return null; },
    insertAdjacentHTML(pos, s) { this.innerHTML += s; },
  };
}
const svg = mkEl('graph'), wrap = mkEl('graphWrap');
global.document = {
  getElementById: (id) => (id === 'graph' ? svg : id === 'graphWrap' ? wrap : mkEl(id)),
  createElement: () => ({ set textContent(v) { this._t = v; }, get innerHTML() { return String(this._t ?? ''); } }),
};
global.esc = (s) => String(s ?? '');
global.cur = {};
global.nodeVisible = () => true;
eval(parts);

const st = JSON.parse(fs.readFileSync(__dirname + '/fixture-status.json', 'utf8'));
renderGraph(st);
const out = svg.innerHTML;

let fails = 0;
const t = (name, ok) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name); };

t('9 node boxes rendered', (out.match(/<rect /g) || []).length === 9);
t('edges rendered (9 deps incl. 2-parent join)', (out.match(/class="edge/g) || []).length === 9);
t('arrow marker defined', out.includes('<marker id="arrow"'));
t('depth lane labels present', out.includes('depth 0') && out.includes('depth 5'));
t('done state styled', out.includes('class="gn done"'));
t('running state styled', out.includes('class="gn running"'));
t('failed state styled', out.includes('class="gn failed"'));
t('escalation warning shown', out.includes('\u26a0'));
t('model labels present', out.includes('qwen3-coder-plus') && out.includes('claude-opus-5'));
t('tooltips present', (out.match(/<title>/g) || []).length === 9);
t('token counts formatted', out.includes('98.0k'));
t('viewBox set', /^0 0 \d+ \d+$/.test(svg._attrs.viewBox || ''));
t('width accommodates 6 depth columns', Number(svg._attrs.width) > 1400);
t('no undefined leaked into markup', !out.includes('undefined'));
t('no NaN in coordinates', !out.includes('NaN'));

// Empty state must not destroy the SVG element.
renderGraph({ nodes: [] });
t('empty state keeps svg alive', document.getElementById('graph') === svg);
t('empty state clears drawing', svg.innerHTML === '');
renderGraph(st);
t('re-render after empty works', (svg.innerHTML.match(/<rect /g) || []).length === 9);

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall renderGraph tests passed');
process.exit(fails ? 1 : 0);
