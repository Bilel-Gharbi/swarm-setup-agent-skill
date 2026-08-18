#!/usr/bin/env bash
# Regression suite for the swarm-setup skill assets.
#   ./tests/run.sh
# Checks syntax, structure (CSS/DOM/JS consistency, nav wiring, page<->server
# contract), the task-graph DAG layout + SVG render, the quota panel math, and
# the model recommendation engine. Requires node + python3, no packages.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
fails=0
run() { echo; echo "=== $1 ==="; shift; "$@" || fails=$((fails+1)); }

echo "=== syntax ==="
python3 - <<'PY'
import re, pathlib
for f in ('dashboard', 'interview'):
    h = pathlib.Path(f'assets/{f}.html').read_text()
    m = re.search(r'<script>(.*)</script>', h, re.S)
    pathlib.Path(f'/tmp/_swarm_{f}.js').write_text(m.group(1))
PY
node --check /tmp/_swarm_dashboard.js && echo "  dashboard.html JS ok" || fails=$((fails+1))
node --check /tmp/_swarm_interview.js && echo "  interview.html JS ok" || fails=$((fails+1))
python3 -c "import ast;ast.parse(open('scripts/serve.py').read());print('  serve.py ok')" || fails=$((fails+1))

run "structural audit"        node tests/audit.js
run "task-graph layout"       node tests/layout_test.js
run "task-graph render"       node tests/render_test.js
run "quota + recommendations" node tests/quota_rec_test.js
run "host portability"        node tests/portability_test.js

echo
if [ "$fails" -eq 0 ]; then echo "ALL SUITES PASSED"; else echo "$fails SUITE(S) FAILED"; fi
exit "$fails"
