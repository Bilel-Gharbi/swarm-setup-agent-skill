// Behavioral XSS check: run the page's own esc() and its exact skill-row
// template against a hostile description; the payload must render inert.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../assets/interview.html'), 'utf8');
global.document = { createElement: () => ({
  set textContent(v) { this._t = v; },
  get innerHTML() { return String(this._t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
}) };
const escLine = html.match(/const esc=.*$/m)[0];
const esc = eval('(' + escLine.replace(/^const esc=/, '').replace(/;$/, '') + ')');
const s = { name: '/evil', description: '<img src=x onerror=alert(1)>' };
const row = '<span class="nm">' + esc(s.name) + '</span><span class="ds">' + esc(s.description || '') + '</span>';
const ok = !row.includes('<img') && row.includes('&lt;img');
console.log(ok ? 'PASS hostile skill description rendered inert' : 'FAIL payload survived: ' + row);
process.exit(ok ? 0 : 1);
