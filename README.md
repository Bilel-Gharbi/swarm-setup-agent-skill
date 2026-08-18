# swarm-setup-agent-skill

An agent skill that turns a repo into a multi-model agent team. It interviews
you (in the browser or in chat), then writes a per-project routing policy that
your agent loads automatically on every session in that repo.

Works under **jcode, Claude Code, opencode, codex, pi, cursor-agent**, or no
host at all (CI / your own runner). Same interview, same artifacts, same
dashboard everywhere. Only the policy filename and the fan-out mechanism differ,
and the skill handles both.

Cheap models implement. Expensive models plan and review. A human approves the
plan before anything fans out. Everything is plain markdown and stdlib Python,
no packages, no accounts, no daemons.

## Why

Running one big model on everything is expensive and slow. Running one cheap
model on everything ships over-engineered, unreviewed code. The useful shape is
a team:

```
BRAIN (strong)  ->  CRITIC (cheap)  ->  HUMAN GATE
   |
   +-- backend  (cheap) -> review (strong) -> fix -> re-review -> test -> qa
   +-- frontend (cheap) -> review (strong) -> fix -> re-review -> test -> qa
   +-- mobile   (cheap) -> review (strong) -> fix -> re-review -> test -> qa
   |
 INTEGRATION GATE (seams between domains) -> ship | rollback
```

`swarm-setup-agent-skill` is how you describe that team once, per project, and keep it.

## Install

Clone into your primary host's skills folder as a REAL directory, then symlink
it into the others.

```bash
# jcode primary (its server does not load symlinked skill dirs)
git clone https://github.com/Bilel-Gharbi/swarm-setup-agent-skill \
  ~/.jcode/skills/swarm-setup-agent-skill
S=~/.jcode/skills/swarm-setup-agent-skill

ln -s $S ~/.claude/skills/swarm-setup-agent-skill            # Claude Code
ln -s $S ~/.config/opencode/skills/swarm-setup-agent-skill   # opencode
ln -s $S ~/.codex/skills/swarm-setup-agent-skill             # codex
ln -s $S ~/.pi/agent/skills/swarm-setup-agent-skill          # pi
ln -s $S ~/.agents/skills/swarm-setup-agent-skill            # shared convention
```

> **Symlink caveat.** Put the real directory in the host you use most. jcode's
> server refuses to load a skill whose directory is a symlink (it is discovered
> and listed, then fails with `Skill '<name>' is not installed on the server`).
> Hosts that only read `SKILL.md` from disk follow symlinks fine. If a host says
> the skill is missing while listing it, move the real directory there and
> symlink the rest.

Requirements: `python3`, plus `node` for the tests. Nothing else, no packages.

Check what it found on your machine:

```bash
python3 $S/scripts/serve.py --detect-hosts
```
```json
{
  "state_dir": "/path/to/project/.swarm",
  "hosts": [
    { "id": "jcode",    "installed": true,  "policy": ".jcode/swarm-prompt.md", "native_swarm": true },
    { "id": "claude",   "installed": true,  "policy": "CLAUDE.md",  "native_swarm": false },
    { "id": "opencode", "installed": true,  "policy": "AGENTS.md",  "native_swarm": false },
    { "id": "codex",    "installed": false, "policy": "AGENTS.md",  "native_swarm": false }
  ]
}
```

## Host support

| Host | Policy file it auto-loads | Fan-out | Cross-provider routing |
|---|---|---|---|
| jcode | `.jcode/swarm-prompt.md` | native `swarm` tool | yes |
| Claude Code | `CLAUDE.md` + `.claude/agents/*.md` | `Task` subagents | within Anthropic only |
| opencode | `AGENTS.md` | `opencode run --model` per node | yes |
| codex | `AGENTS.md` | `codex exec --model` per node | yes |
| pi | `AGENTS.md` | `pi -p --provider --model` per node | yes |
| cursor-agent | `AGENTS.md` | `cursor-agent -p` per node | limited |
| none / CI | `AGENTS.md` | your runner reads `tasks.md` | yes |

jcode is the only host with a native swarm primitive, so it gets dependency
ordering, concurrency limits, and typed node artifacts for free. On every other
host the skill compensates explicitly: one prompt file and one output file per
node, dependency order and concurrency enforced by the coordinator, timeboxes
via `timeout`, and the same `swarm-status.json` written by hand so the dashboard
is identical. Claude Code additionally gets one generated subagent file per
role, since it selects subagents by file rather than by a routing prompt.

The state directory is host-neutral: `--state-dir`, else `$SWARM_STATE_DIR`,
else an existing `.jcode/`, else `.swarm/`.

## Use it

In a jcode session at your project root:

```
/swarm-setup-agent-skill
```

The agent runs the sequence below for you. These are the exact commands, if you
want to drive it yourself or wire it into CI.

### 1. Export the model routes the form should offer

```bash
mkdir -p .swarm
cat > .swarm/swarm-models.json <<'JSON'
{"generated":"2026-08-18","models":[
  {"route":"claude-api:claude-fable-5","available":true},
  {"route":"gpt-5.5","available":true},
  {"route":"zai:glm-5.2","available":true},
  {"route":"qwen3-coder-plus","available":true},
  {"route":"kimi:kimi-k2","available":false,"login":"jcode login kimi"}]}
JSON
```

Get this list live so the form only ever offers routes you can actually reach:
`swarm list_models` (jcode), `opencode models`, `pi --help`'s provider flags, or
your host's equivalent. Unavailable routes still appear, with the login command
that unblocks them.

### 2. Serve the interview and dashboard

```bash
SKILL_DIR=~/.jcode/skills/swarm-setup-agent-skill
python3 $SKILL_DIR/scripts/serve.py --port 7777 --project-dir . --state-dir .swarm
```

| URL | What it is |
|---|---|
| `http://127.0.0.1:7777` | the interview form (scans your installed skills live) |
| `.../dashboard#board` | kanban by phase or by domain |
| `.../dashboard#graph` | the live task DAG, laid out by dependency depth |
| `.../dashboard#activity` | event log |
| `.../dashboard#usage` | tokens by role + provider 5h/weekly quota bars |

The browser polls the server every 2 seconds. That is process-to-process and
costs zero model tokens.

### 3. Block until the form is submitted

```bash
python3 $SKILL_DIR/scripts/serve.py --wait-for answers --state-dir .swarm --timeout 3600
# exit 0 -> .swarm/swarm-answers.json was written; exit 1 -> timeout
```

One blocking call, never a poll loop. That distinction is the whole reason this
skill is cheap to run.

### 4. Human gate, after the brain writes plan.md + contracts.md

```bash
# coordinator sets  "gate":"waiting"  in .swarm/swarm-status.json, then:
python3 $SKILL_DIR/scripts/serve.py --wait-for approval --state-dir .swarm --timeout 7200
cat .swarm/swarm-approval.json   # {"approved":true,"note":"ship it"}
```

Approving the plan is the last cheap moment to stop. After fan-out you are
paying N branches to be wrong.

### 5. Inspect and tune while it runs

```bash
curl -s localhost:7777/api/models | head -c 300   # routes offered
curl -s localhost:7777/api/skills | head -c 300   # live-scanned skills (all hosts)
curl -s localhost:7777/api/hosts                  # detected hosts + state dir
curl -s localhost:7777/api/status | head -c 300   # what the kanban renders
curl -s localhost:7777/api/quota

curl -s -X POST localhost:7777/api/quota \
  -H 'Content-Type: application/json' \
  -d '{"provider":"anthropic","cap_5h":3000000,"cap_week":12000000}'
```

### 6. Stop

```bash
pkill -f "serve.py --port 7777"
```

### 7. Run the swarm (no server needed once the policy exists)

On jcode, the native tool does the orchestration:

```
swarm task_graph mode=deep nodes=[...]
swarm run_plan concurrency_limit=4
swarm status
```

On any other host, the coordinator launches one process per ready node and
enforces the DAG itself:

```bash
# opencode
opencode run --model anthropic/claude-sonnet-4-5 "$(cat .swarm/node-be1.md)" > .swarm/out-be1.md

# codex
codex exec --model gpt-5-codex --cd ./api "$(cat .swarm/node-be1.md)" > .swarm/out-be1.md

# pi (best non-jcode option for mixed providers)
pi -p --provider zai --model glm-4.6 --session-id be1 "$(cat .swarm/node-be1.md)" > .swarm/out-be1.md
```

Wrap each in `timeout 1800` so a hung node is detected, not just a failing one.

## Files

All under the resolved state dir (`.swarm/`, or `.jcode/` under jcode).

| File | Written by | Purpose |
|---|---|---|
| `swarm-models.json` | you, before serving | routes + availability for the form |
| `swarm-answers.json` | the web form | full interview answers, reusable across repos |
| `swarm-prompt.md` | the agent, after answers | the routing policy jcode auto-loads |
| `swarm-status.json` | the coordinator, per event | kanban nodes, events, costs, usage |
| `swarm-quota.json` | dashboard or curl | per-provider 5h + weekly caps |
| `swarm-approval.json` | dashboard | human gate verdict |

Commit `swarm-prompt.md` and `swarm-answers.json`. Your teammates then inherit
the same team. Add the rest to `.gitignore`.

## Example: `.swarm/swarm-answers.json`

Drop this into any repo's state dir and `/swarm-setup-agent-skill` skips the interview
entirely, only asking about fields that are missing or invalid. The file is
host-independent, so the same team definition works under jcode, pi, opencode,
or codex.

```json
{
  "_format": "swarm-answers/v1",
  "generated": "2026-08-18T13:40:00.000Z",
  "project": "acme-shop",
  "topology": "multi-repo",
  "spec": {
    "mode": "ingest",
    "draft_path": "./docs/spec-draft.md",
    "design_folder": "./design/opendesign-export"
  },
  "roles": {
    "brain": {
      "model": "claude-api:claude-fable-5",
      "effort": "high",
      "enabled": true,
      "skills": ["/brainstorming", "/make-plan", "/writing-plans", "/ponytail"]
    },
    "implementers": [
      { "name": "backend",  "path": "./api",
        "model": "zai:glm-5.2", "effort": "low",
        "skills": ["/ponytail", "/test-driven-development"] },
      { "name": "frontend", "path": "./web",
        "model": "zai:glm-5.2", "effort": "low",
        "skills": ["/ponytail", "/test-driven-development"] },
      { "name": "mobile",   "path": "./mobile",
        "model": "qwen3-coder-plus", "effort": "low",
        "skills": ["/ponytail", "/test-driven-development"] }
    ],
    "reviewer": {
      "model": "claude-api:claude-opus-5", "effort": "high", "per_implementer": true,
      "skills": ["/agent-code-reviewer", "/ponytail-review", "/verification-before-completion"]
    },
    "tester": { "model": "claude-api:claude-sonnet-5", "effort": "medium", "enabled": true,
                "skills": ["/test-gaps"] },
    "qa_web": { "model": "claude-api:claude-sonnet-5", "effort": "medium", "enabled": true,
                "env_up": "cd web && npm run dev  # health: http://localhost:3000",
                "skills": ["/browser-test"] },
    "qa_mobile": { "model": "claude-api:claude-sonnet-5", "effort": "medium", "enabled": true,
                   "env_up": "cd mobile && npm run ios  # boots simulator",
                   "skills": [] },
    "fixer": { "model": "same-as-implementer", "effort": "low",
               "skills": ["/ponytail", "/receiving-code-review", "/systematic-debugging"] }
  },
  "concurrency": 4,
  "spawn_mode": "inline",
  "mode": "deep",
  "escalation": { "after_failures": 2, "target": "claude-api:claude-sonnet-5", "on_second_failure": "halt-and-ask-human" },
  "human_gate": true,
  "obsidian_vault": null
}
```

## Example: the generated policy

This is the output. The filename depends on the host (`.jcode/swarm-prompt.md`,
`CLAUDE.md`, or `AGENTS.md`); the content is the same. Your agent injects it as
a prompt into every session started in this repo.

```markdown
<!-- Swarm policy for acme-shop — generated 2026-08-18 -->

## Roles

- BRAIN (plan/architect): claude-fable-5, effort high. Fallback: claude-sonnet-5.
  Skills: /brainstorming, /make-plan, /ponytail. Writes plan.md + contracts.md,
  updates architecture.md. Never writes code.
- CRITIC: claude-sonnet-5, effort low. Adversarial pass over plan.md +
  contracts.md before the human gate. Hunts contradictions, over-scope,
  interface mismatches.
- IMPLEMENTER:backend (./api): zai:glm-5.2, effort low. Owns unit tests.
- IMPLEMENTER:frontend (./web): zai:glm-5.2, effort low. Builds against
  contracts.md + design.md.
- IMPLEMENTER:mobile (./mobile): qwen3-coder-plus, effort low. Builds against
  contracts.md + design.md.
- REVIEWER (one per implementer): claude-opus-5, effort high.
  Context: diff + spec.md + contracts.md (+ design.md for UI). Never the whole repo.
- TESTER (integration + /test-gaps audit): claude-sonnet-5, effort medium.
- QA:web (E2E): claude-sonnet-5. Native browser tool + /browser-test.
  env-up first: cd web && npm run dev, health-check http://localhost:3000.
- QA:mobile (E2E): claude-sonnet-5. Maestro YAML flows via bash.
- FIXER: same model as the failing branch's implementer, effort low.
  Fixed diffs go back to the reviewer for delta re-review. Max 2 loops.

## Repos

Multi-repo. backend=./api, frontend=./web, mobile=./mobile, each its own git.
Trees are disjoint, so all three branches run in parallel with no worktrees.
Shared artifacts live in this coordinator folder's state dir (.swarm/).

## Rules

- Run swarm in deep mode. depends_on enforces order; artifacts carry findings,
  what_i_did_not_check, and confidence.
- The model that wrote code never approves it. Fixer output gets delta re-review.
- A reviewer with confidence: low must inject_gap, not pass the gate.
- contracts.md is binding; changing it is a re-planning event.
- Concurrency limit 4. spawn_mode: inline. Prefer repo files over agent chat.
- QA writes a 3-5 line intent summary for the human, not just pass/fail.
- After each run_plan: /cost-report per role, append to costs.md.

## Escalation

- 2 failed attempts on ANY node escalate it to claude-sonnet-5, carrying the
  failure artifact forward as required reading.
- Per-node timebox 30 min; a hung node counts as a failed attempt.
- Failing again after escalation: HALT and ask the human.

## Rollback

- Integration gate fails twice -> halt. Revert order: mobile PR, web PR, then
  api PR (consumers before providers). The human decides; agents propose.
```

## Example: `.swarm/swarm-status.json`

The coordinator rewrites this in the same turn it already handles a node event,
so the dashboard is live for free. `depends_on` is required or the graph view
collapses into one flat column.

```json
{
  "project": "acme-shop",
  "updated": "2026-08-18T14:02:11Z",
  "gate": "approved",
  "escalations": 1,
  "cost_total": 0.42,
  "nodes": [
    { "id": "plan", "content": "architecture + contracts", "role": "brain",
      "domain": "all", "model": "claude-api:claude-fable-5", "state": "done",
      "attempts": 1, "depends_on": [], "confidence": "high" },
    { "id": "be1", "content": "auth endpoints", "role": "implementer",
      "domain": "backend", "model": "zai:glm-5.2", "state": "review",
      "attempts": 1, "depends_on": ["plan"] },
    { "id": "fe1", "content": "login screen", "role": "implementer",
      "domain": "frontend", "model": "zai:glm-5.2", "state": "running",
      "attempts": 2, "escalated": true, "depends_on": ["plan"] },
    { "id": "int", "content": "web+mobile against real api", "role": "integration",
      "domain": "all", "model": "claude-api:claude-sonnet-5", "state": "pending",
      "depends_on": ["be1", "fe1"] }
  ],
  "events": [
    { "time": "13:58", "msg": "human approved plan.md + contracts.md" },
    { "time": "14:01", "msg": "frontend escalated after 2 failures" }
  ],
  "costs": { "implementer:backend": { "tokens": 128400, "usd": 0.06 } },
  "usage": [
    { "model": "zai:glm-5.2", "session": "ag_7f1", "tokens": 128400, "ts": "2026-08-18T14:01:02Z" }
  ]
}
```

Node states the kanban understands: `pending`, `planning`, `awaiting_approval`,
`running`, `review`, `fixing`, `rereview`, `testing`, `env_up`, `qa`,
`integration`, `done`, `failed`, `halted`, `escalated`.

## Artifact chain

Plain markdown, all optional except where noted.

```
constitution.md   once, durable principles
architecture.md   durable codebase map, the brain UPDATES it instead of re-deriving
      v
spec.md           ingested draft (cheap, default) OR generated OR skipped
design.md         from /design-ingest, optional
tokens.md         from /design-ingest, optional
      v
plan.md           brain: tech approach + Mermaid diagrams
contracts.md      brain: API/interface contract, required for multi-domain
      v
critic pass       cheap adversarial review of plan + contracts
HUMAN GATE        approve plan + contracts
      v
tasks.md          the DAG that seeds swarm task_graph
      v
fan out per domain -> review -> fix -> delta re-review -> test -> env-up -> QA
      v
integration gate -> ship | rollback | budget halt
costs.md          per-role /cost-report numbers after each run
```

## Design decisions worth knowing before you fork

- **Spec ingestion is the default.** Authoring a spec with the brain model is
  the most expensive single output in the flow. Most people already have a
  draft. The brain validates it and appends open questions instead of rewriting.
- **Reviewer context is bounded.** Diff + spec + contracts, never a repo crawl.
  Unbounded reviewer context is the main hidden token cost of agent swarms.
- **A reviewer is never the same model family as the implementer it reviews.**
- **Unit tests belong to implementers, integration tests to testers.** Never
  both writing unit tests for the same code.
- **The model never polls.** Two blocking `--wait-for` calls, and the browser
  handles refresh.
- **Obsidian is a reading layer, not a memory store.** Writing linked notes is
  nearly free; reading a vault into context is not, and jcode already has
  semantic memory.
- **Mermaid only for diagrams.** Auto-layout, renders natively in jcode and
  Obsidian, near-zero tokens.

## Security model

The server is a local convenience UI, not a hardened service. Its threat model:

- **Binds to 127.0.0.1 only.** It is never reachable from the network. Do not
  reverse-proxy it to the internet; it has no auth.
- **CSRF / DNS-rebinding guarded.** State-changing POSTs (`/api/answers`,
  `/api/approve`, `/api/quota`) reject any non-localhost `Origin` or `Host`, so
  a malicious web page open in your browser cannot auto-approve the human gate.
  Requests without an Origin (curl, the agent) are allowed. POST bodies are
  capped at 2 MB.
- **Rendered content is escaped.** Both pages HTML-escape everything read from
  status/answers/skill files, so a hostile `swarm-status.json` committed to a
  repo you cloned cannot script the dashboard.
- **The server writes only `swarm-*.json` inside the state dir.** It never
  executes anything and never touches your code.
- **The real risk is not this server.** It is the agents the policy spawns:
  they run with your shell, your credentials, and your git. The human gate,
  bounded reviewer context, and halt-on-repeated-failure rules exist for that
  reason. Keep the gate on for anything that can reach production.

## What it covers, and what it does not

Covered:

- Role/model/effort routing per project, written once, loaded every session.
- Cheap-implementer / strong-reviewer separation, with the writer-never-approves
  rule extended to the fixer (delta re-review).
- Dependency-ordered fan-out, per-branch review/fix/test/QA, and a terminal
  integration gate across domains.
- Two human gates (plan approval, dashboard verdict) with zero-token waiting.
- Live kanban, task DAG, event log, and per-provider quota tracking.
- Escalation with carried-forward failure artifacts, timeboxes, and
  halt-and-ask-human as the terminal state.
- Multi-repo and monorepo topologies, including the parallel-writer worktree rule.
- Spec ingestion, design ingestion, durable `architecture.md`, cost telemetry.

Not covered, by design or honestly not yet:

- **Enforcement on non-native hosts.** Outside jcode, `depends_on`, concurrency
  caps, and timeboxes are conventions the coordinating agent must follow, not
  mechanisms. A sloppy coordinator can ignore the policy; nothing blocks it.
- **Hard budget enforcement.** Quota caps are advisory routing signals. Nothing
  kills a run at a spend threshold. Watch the usage panel for long runs.
- **Token/cost accounting accuracy.** Usage numbers are whatever the
  coordinator reports. Anthropic meters messages, not tokens, so those caps are
  soft guidance either way.
- **Merge conflicts and shared-file races beyond the stated rules.** The
  worktree/sequencing rule is written into the policy, but nothing technically
  prevents two agents writing one tree if the coordinator disobeys.
- **Secrets management.** Agents inherit your environment. The skill does not
  scrub env vars, and a prompt-injected dependency could exfiltrate through any
  spawned agent. Scope credentials before running swarms on untrusted code.
- **Sandboxing.** No container, no filesystem jail. Use your host's sandbox
  flags (e.g. codex sandbox modes) if you need one.
- **Multi-machine or multi-user coordination.** One project dir, one machine,
  one human. State files are not locked; concurrent human edits can race the
  coordinator's rewrites.
- **Windows.** Untested. The server is pure stdlib and should run, but the
  documented commands assume a POSIX shell.

## Tests

```bash
~/.jcode/skills/swarm-setup-agent-skill/tests/run.sh
```

Node plus python3, no packages. Covers syntax, a structural audit of the HTML
(every markup class has CSS, no dangling `getElementById`, balanced tags, no
duplicate ids, nav-to-view wiring, page-to-endpoint contract), the DAG layout
and SVG render, the quota window math, the model recommendation engine, and host
portability (no hardcoded `.jcode/` in markup or logic, every adapter documented,
state dir overridable).

It has caught real bugs: a destroyed SVG element on empty state, a filter bar
trapped inside one view, an always-empty flat-rate quota expression. Run it
rather than eyeballing the HTML.

## Layout

```
SKILL.md              the instructions the agent follows
assets/interview.html the interview form + recommendation engine
assets/dashboard.html board, task graph, activity, usage/quota
scripts/serve.py      stdlib-only server + the two --wait-for gates
tests/run.sh          regression suite
```

## Notes

- Default port is 7777. If it is busy, pass `--port` and tell the user the URL.
- Pass the same `--state-dir` to every `serve.py` call in one run.
- Keep the real skill directory in your primary host and symlink the others; see
  the symlink caveat under Install.
- The skill scanner reads every host's skill folder, so a role can require a
  skill you installed under a different agent.
- Model routes are never hardcoded. Whatever `swarm list_models` reports shows
  up in the form, so new models need no edit to this skill.
- Flat-rate subscription routes are preferred for volume roles (implement,
  test, QA); metered routes are reserved for review gates and escalation.
  A provider at 75% of its cap is a signal to re-route.

## License

MIT.
