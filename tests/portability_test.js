#!/usr/bin/env node
// Host portability: the skill must not hardcode one agent host.
// Checks serve.py's host table + state-dir resolution, and that the HTML
// carries no baked-in ".jcode" path text.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const py = fs.readFileSync(path.join(root, 'scripts/serve.py'), 'utf8');

console.log('\n--- host table ---');
for (const h of ['jcode', 'claude', 'opencode', 'codex', 'pi', 'cursor'])
  ok(new RegExp(`"${h}"\\s*:`).test(py), `HOSTS knows ${h}`);
ok(/def detect_hosts\(/.test(py), 'detect_hosts() exists');
ok(/"native_swarm"/.test(py), 'hosts declare native_swarm capability');
ok(/--detect-hosts/.test(py), '--detect-hosts flag exposed');
ok(/\/api\/hosts/.test(py), '/api/hosts endpoint served');

console.log('\n--- skill scan paths cover every host ---');
for (const p of ['".jcode" / "skills"', '".claude" / "skills"',
                 '"opencode" / "skills"', '".codex" / "skills"',
                 '".pi" / "agent" / "skills"', '".agents" / "skills"'])
  ok(py.includes(p), `scans ${p}`);

console.log('\n--- state dir is neutral + overridable ---');
ok(/def resolve_state_dir\(/.test(py), 'resolve_state_dir() exists');
ok(/SWARM_STATE_DIR/.test(py), 'honours $SWARM_STATE_DIR');
ok(/--state-dir/.test(py), '--state-dir flag exposed');
ok(/for cand in \(".jcode", ".swarm"\)/.test(py), 'prefers existing .jcode/ then .swarm/');
ok(!/self\.project_dir \/ "\.jcode"/.test(py), 'no handler writes hardcoded .jcode/');

console.log('\n--- assets carry no hardcoded host path ---');
for (const f of ['assets/interview.html', 'assets/dashboard.html']) {
  const h = fs.readFileSync(path.join(root, f), 'utf8');
  // strip JS line comments; a comment explaining the adapter is fine, a
  // hardcoded path in markup or logic is not.
  const code = h.replace(/^\s*\/\/.*$/gm, '');
  ok(!/\.jcode\//.test(code), `${f} has no literal .jcode/ path in markup or logic`);
  ok(/class="statedir"/.test(h), `${f} uses .statedir placeholder`);
  ok(/function applyStateDir\(/.test(h), `${f} resolves state dir at runtime`);
}


console.log('\n--- server hardening ---');
ok(/def _local_request\(/.test(py), 'CSRF/DNS-rebinding guard exists');
ok(/MAX_BODY/.test(py), 'POST body size cap exists');
ok(/_send\(403/.test(py), 'cross-origin POST rejected with 403');
ok(/127\.0\.0\.1", args\.port/.test(py), 'server binds loopback only');

console.log('\n--- docs describe the adapters ---');
const skill = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
ok(/## Host adapters/.test(skill), 'SKILL.md has a Host adapters section');
for (const h of ['jcode', 'Claude Code', 'opencode', 'codex', 'pi'])
  ok(skill.includes(h), `SKILL.md mentions ${h}`);
ok(/AGENTS\.md/.test(skill), 'SKILL.md names the AGENTS.md policy target');

console.log(fails ? `\n${fails} portability test(s) failed` : '\nall portability tests passed');
process.exit(fails ? 1 : 0);
