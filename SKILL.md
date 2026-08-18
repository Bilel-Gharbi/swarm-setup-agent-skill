---
name: swarm-setup-agent-skill
description: Interactively design a per-project multi-model swarm team and write a routing policy the host agent auto-loads (jcode, Claude Code, opencode, codex, pi, cursor). Use for "set up a swarm", "configure my agents for this project", "who is the brain model", "assign models to roles", or "use my spec draft".
---

# Swarm Setup

You configure a project's multi-model agent team by interviewing the user, then
writing a per-project routing policy that the HOST AGENT loads automatically on
every session started in this repo.

This skill is HOST-AGNOSTIC. Read `## Host adapters` FIRST to learn where the
policy file goes and how to fan out on the host you are running under, then
follow the rest of this document. Everything after the adapters section is
host-independent: the interview, the artifact chain, the safety rules, and the
generated policy are identical everywhere. Only two things vary: the policy
FILENAME and the fan-out MECHANISM.

## Host adapters

Detect the host first. You usually know which agent you are; if not, run:

```bash
python3 ~/.jcode/skills/swarm-setup-agent-skill/scripts/serve.py --detect-hosts
```

It prints the resolved state directory and every agent CLI installed on this
machine, each with its policy filename, login command, and whether it has a
native swarm/subagent primitive.

| Host | Policy file it auto-loads | Fan-out mechanism | Native swarm |
|---|---|---|---|
| jcode | `./.jcode/swarm-prompt.md` | `swarm` tool (`task_graph`, `run_plan`) | yes |
| Claude Code | `./CLAUDE.md` (+ `.claude/agents/*.md`) | `Task` subagents, one per role file | partial |
| opencode | `./AGENTS.md` | `opencode run --model <route>` per node via bash | no |
| codex | `./AGENTS.md` | `codex exec --model <route>` per node via bash | no |
| pi | `./AGENTS.md` | `pi -p --provider X --model Y` per node via bash | no |
| cursor-agent | `./AGENTS.md` | `cursor-agent -p` per node via bash | no |
| none / CI | `./AGENTS.md` | your own runner reads `tasks.md` | no |

### State directory

Coordination files (`swarm-*.json`) live in a neutral state dir, NOT necessarily
`.jcode/`. `serve.py` resolves it in this order: `--state-dir`, then
`$SWARM_STATE_DIR`, then an existing `.jcode/` (jcode back-compat), then
`.swarm/`. Pass the SAME `--state-dir` to every `serve.py` call in one run, and
write the artifacts there. Under jcode you get `.jcode/` for free; under any
other host prefer `.swarm/`:

```bash
python3 $SKILL_DIR/scripts/serve.py --port 7777 --project-dir . --state-dir .swarm
python3 $SKILL_DIR/scripts/serve.py --wait-for answers --state-dir .swarm --timeout 3600
```

In the rest of this document, `<state>/` means that resolved directory. Where a
path reads `.jcode/`, substitute `<state>/`.

### Adapter: jcode (native, the reference implementation)

Write `./.jcode/swarm-prompt.md`. Get models from the `swarm list_models` tool.
Fan out with the `swarm` tool: `task_graph mode=deep`, then `run_plan
concurrency_limit=N`. Roles map to spawned agents with `model`, `effort`,
`label`, and `working_dir`. Nothing else to do.

### Adapter: Claude Code

Write the policy to `./CLAUDE.md` (append under a `# Swarm policy` heading; do
NOT clobber an existing CLAUDE.md). ALSO materialize one subagent file per role
in `./.claude/agents/<role>.md`, because Claude Code selects subagents by file,
not by a routing prompt:

```markdown
---
name: reviewer-backend
description: Reviews backend diffs against spec.md and contracts.md. Never writes code.
model: opus
tools: Read, Grep, Glob, Bash
---
Read ONLY the diff, spec.md, and contracts.md. Do not crawl the repo.
Report findings, what_i_did_not_check, and a confidence level.
If confidence is low, say so instead of approving.
```

Model routing is per-subagent (`model:` frontmatter: `haiku|sonnet|opus` or an
explicit id), so cross-provider cheap implementers are NOT available. Say this
plainly: on Claude Code the cheap/expensive split is within one family. Fan out
with the `Task` tool, one call per node, respecting `depends_on` yourself.

### Adapter: opencode

Write `./AGENTS.md`. Models come from `opencode models`; auth via
`opencode auth login`. Fan out with one background bash call per node:

```bash
opencode run --model anthropic/claude-sonnet-4-5 \
  "$(cat .swarm/node-be1.md)" > .swarm/out-be1.md 2>&1
```

opencode also has its own `agent` config, so a role can become a named agent in
`opencode.jsonc` when the user prefers that over per-node prompts.

### Adapter: codex

Write `./AGENTS.md` (codex reads it natively). Fan out with:

```bash
codex exec --model gpt-5-codex --full-auto \
  "$(cat .swarm/node-be1.md)" > .swarm/out-be1.md 2>&1
```

Use `--cd <dir>` for the multi-repo `working_dir` per role. Sandbox/approval
flags are the user's call; never widen them silently.

### Adapter: pi

Write `./AGENTS.md`. pi routes per invocation, which makes it the best
non-jcode host for genuinely mixed-provider teams:

```bash
pi -p --provider anthropic --model claude-sonnet-4-5 --session-id be1 \
   "$(cat .swarm/node-be1.md)" > .swarm/out-be1.md 2>&1
```

`--provider/--model` per node gives real cheap-implementer + expensive-reviewer
splits. `--session-id` keeps a node resumable across the review/fix loop, and
`--mode json` makes output machine-readable for the status file.

### Adapter: no host (CI or your own runner)

Everything still works: the interview writes `<state>/swarm-answers.json`, you
write `AGENTS.md` + `tasks.md`, and the dashboard renders whatever writes
`<state>/swarm-status.json`. The server needs only python3.

### Rules for every non-native host

Hosts without a native swarm primitive lose the guarantees the `swarm` tool
gives for free. YOU must supply them, or the policy is decorative:

- `depends_on` is enforced by you: never launch a node before its parents are
  terminal.
- Concurrency limit is enforced by you: cap live background bash jobs.
- Each node gets its own prompt file `<state>/node-<id>.md` (its task, its
  required reading, its role rules) and writes one output file. That file IS the
  node artifact. No agent-to-agent chat.
- You write `<state>/swarm-status.json` yourself after each node finishes, so
  the dashboard, graph, and quota panel keep working identically.
- Timebox every node (`timeout 1800 <cmd>`); a hung node counts as a failure.
- The two human gates are unchanged: `--wait-for answers` and
  `--wait-for approval`.

## Quickstart command reference

All commands below are verified. `SKILL_DIR` is `~/.jcode/skills/swarm-setup-agent-skill`.
Run everything from the PROJECT ROOT. The user invokes the skill as
`/swarm-setup-agent-skill`; these are the commands YOU run to serve it.

```bash
SKILL_DIR=~/.jcode/skills/swarm-setup-agent-skill

# 1. INIT — create .jcode/ and export live model routes for the form.
#    Get the routes from the `swarm list_models` tool, then write the file.
mkdir -p .jcode
cat > .jcode/swarm-models.json <<'JSON'
{"generated":"2026-08-05","models":[
  {"route":"zai:glm-5.2","available":true},
  {"route":"claude-opus-5","available":true},
  {"route":"qwen3-coder-plus","available":true},
  {"route":"kimi:kimi-k2","available":false,"login":"jcode login kimi"}]}
JSON

# 2. SERVE — start the interview + dashboard server as a BACKGROUND task.
python3 $SKILL_DIR/scripts/serve.py --port 7777 --project-dir .
#    Then open it for the user (open tool):
#      interview  -> http://127.0.0.1:7777
#      dashboard  -> http://127.0.0.1:7777/dashboard
#        board    -> http://127.0.0.1:7777/dashboard#board
#        graph    -> http://127.0.0.1:7777/dashboard#graph      (live task DAG)
#        activity -> http://127.0.0.1:7777/dashboard#activity
#        usage    -> http://127.0.0.1:7777/dashboard#usage      (quota bars)

# 3. INTERVIEW — block in ONE call until the user submits the form.
#    Exits 0 on submit (writes .jcode/swarm-answers.json), 1 on timeout.
python3 $SKILL_DIR/scripts/serve.py --wait-for answers --timeout 3600

# 4. HUMAN GATE — after writing plan.md + contracts.md, set
#    "gate":"waiting" in .jcode/swarm-status.json, then block once:
python3 $SKILL_DIR/scripts/serve.py --wait-for approval --timeout 7200
#    Then read .jcode/swarm-approval.json -> {"approved":bool,"note":str}

# 5. INSPECT — sanity-check endpoints while the server runs (optional).
curl -s localhost:7777/api/models  | head -c 300   # routes the form offers
curl -s localhost:7777/api/skills  | head -c 300   # live-scanned skills
curl -s localhost:7777/api/status  | head -c 300   # what the kanban renders
curl -s localhost:7777/api/quota                   # provider caps

# 6. QUOTA — edit a provider cap from the CLI (the dashboard ✎ does this too).
curl -s -X POST localhost:7777/api/quota \
  -H 'Content-Type: application/json' \
  -d '{"provider":"anthropic","cap_5h":3000000,"cap_week":12000000}'

# 7. STOP — when the run is finished and the user is done with the dashboard.
pkill -f "serve.py --port 7777"

# 8. TEST — after ANY edit to assets/ or scripts/, run the regression suite.
$SKILL_DIR/tests/run.sh
```

The suite (`tests/run.sh`, node + python3 only, no packages) covers syntax,
a structural audit (every markup class has CSS, no dangling `getElementById`,
balanced tags, no duplicate ids, nav↔view wiring, page↔server endpoint
contract), the task-graph DAG layout and SVG render, the quota window math,
and the model recommendation engine. It has already caught real bugs (a
destroyed SVG element on empty state, a filter bar trapped inside one view, an
always-empty flat-rate quota expression), so run it rather than eyeballing
the HTML.

Ports: default 7777. If busy, pick another and tell the user the new URL.
NEVER poll `/api/status` from the model in a loop; the browser polls it for
free. The model only ever uses the two `--wait-for` blocking calls.

Files this skill reads/writes under `./.jcode/`:

| File | Written by | Purpose |
|---|---|---|
| `swarm-models.json` | you, before serving | routes + availability for the form |
| `swarm-answers.json` | the web form (POST) | full interview answers |
| `swarm-prompt.md` | you, after answers | the routing policy jcode auto-loads |
| `swarm-status.json` | coordinator, each event | kanban nodes, events, costs, usage |
| `swarm-quota.json` | dashboard / curl | per-provider 5h + weekly caps |
| `swarm-approval.json` | dashboard (POST) | human gate verdict |

Once `swarm-prompt.md` exists, a plain `swarm` run needs no server at all:

```bash
# after the policy exists, normal swarm usage (tool calls, not bash):
#   swarm task_graph  mode=deep  nodes=[...]
#   swarm run_plan    concurrency_limit=4
#   swarm status / swarm summary
```


## Web configurator answers file (skip the interview when present)

BEFORE starting the interview, check for `./.jcode/swarm-answers.json`
(format `swarm-answers/v1`, produced by the swarm-configurator web page). If it
exists:

1. Read it. It contains the full interview answers: project, topology, spec
   mode/draft path/design folder, every role with its model, effort, and its
   list of MANDATORY skills, concurrency, spawn_mode, swarm mode, escalation,
   human-gate flag, and optional Obsidian vault.
2. Do NOT re-ask those questions. Only ask about fields that are missing,
   null, or invalid.
3. Still run `swarm list_models` and validate every chosen model route. For
   any unavailable route, tell the user the `jcode login <provider>` command
   that unblocks it and ask for a substitute (or use the recorded fallback).
4. Generate `./.jcode/swarm-prompt.md` from the answers. Each role's skills
   from the JSON are written as MANDATORY: the policy must say each role
   invokes its listed skills as part of doing its work, in every session of
   this project.
5. Summarize the loaded config in a few lines and ask for one confirmation
   before writing. If the user edits anything, update the answers JSON too so
   web and policy stay in sync.

If the file does not exist, run the normal interview below, and at the end
OFFER to also write `./.jcode/swarm-answers.json` capturing the answers, so
the config is editable in the web page later and reusable across projects
(the user can copy one answers file into any repo's `.jcode/`).

## Model recommendation (budget-aware)

The interview page ships a recommendation engine (`RECS` in interview.html):
it scores every LIVE route from `/api/models` per role and preselects the
best one, showing a `★ recommended: <route>` hint with the reason. Priority
order favors flat-rate subscription routes (zai, alibaba-coding-plan, qwen,
kimi) for volume roles (implementer, tester, QA) and reserves metered routes
(Claude, GPT) for review gates and escalation targets. The reviewer is
auto-picked from a DIFFERENT model family than the implementer it reviews.
A "★ apply recommended models" button re-runs the scoring. Do not hardcode
model names when describing the form to the user; the recs adapt to whatever
routes `swarm list_models` reports.

## Live server mode (interview in browser + kanban dashboard)

This skill ships `scripts/serve.py` (stdlib-only) and `assets/interview.html` +
`assets/dashboard.html`. Prefer this mode when the user is present; fall back
to the chat interview when they decline or the port is busy.

Launch sequence (token-efficient, NEVER poll from the model):

1. Export live models for the form: run `swarm list_models`, write the result
   as `./.jcode/swarm-models.json` in this shape:
   `{"generated":"<date>","models":[{"route":"zai:glm-5.2","available":true},`
   `{"route":"kimi:kimi-k2","available":false,"login":"jcode login kimi"}]}`.
   The form reads this file, so any future model (Kimi 3, new GLM/GPT) appears
   automatically with its availability and login hint.
2. Start the server as a BACKGROUND task:
   `python3 <skill_dir>/scripts/serve.py --port 7777 --project-dir .`
   then open `http://127.0.0.1:7777` for the user (open tool). The page scans
   ALL installed skills live (`~/.jcode/skills`, `~/.claude/skills`,
   `~/.pi/agent/skills`, `~/.agents/skills`, `./.jcode/skills`) and offers a
   searchable picker per role.
3. Wait with ONE blocking call (not a poll loop):
   `python3 <skill_dir>/scripts/serve.py --wait-for answers --timeout 3600`
   It exits 0 the moment the user submits (the POST writes
   `./.jcode/swarm-answers.json` directly into the repo). Then proceed exactly
   as in "Web configurator answers file" above.
4. LEAVE THE SERVER RUNNING for the dashboard at
   `http://127.0.0.1:7777/dashboard`.

Dashboard contract (bake these as RULES into the generated swarm-prompt.md):

- The coordinator maintains `./.jcode/swarm-status.json` and rewrites it in
  the SAME turn it already processes a node event (spawn, state change, review
  verdict, escalation, completion). No extra turns, just a small JSON write:
  `{"project":"<name>","updated":"<iso-time>","gate":"none|waiting|approved",`
  ` "escalations":0,"cost_total":null,`
  ` "nodes":[{"id":"t1","content":"...","role":"implementer","domain":"backend",`
  `   "model":"zai:glm-5.2","state":"running","attempts":1,"escalated":false,`
  `   "confidence":null}],`
  ` "events":[{"time":"12:01","msg":"backend review passed"}],`
  ` "costs":{"implementer:backend":{"tokens":12345,"usd":0.04}}}`
  Node `state` values the kanban understands: pending, planning,
  awaiting_approval, running, review, fixing, rereview, testing, env_up, qa,
  integration, done, failed, halted, escalated.
- HUMAN GATE via dashboard: when the plan is ready, set `"gate":"waiting"` in
  the status file, then block with ONE call:
  `python3 <skill_dir>/scripts/serve.py --wait-for approval --timeout 7200`.
  Read `./.jcode/swarm-approval.json`: `{"approved":true|false,"note":"..."}`.
  Rejected -> feed the note back to the brain and re-plan.
- After the run, update status one final time (all nodes terminal) and append
  per-role numbers to `costs.md` (also mirror into the status file's `costs`).
- USAGE LEDGER for the quota panel: every time the coordinator writes
  `swarm-status.json`, include a top-level `usage` array with one entry per
  finished task: `{"model":"<route>","session":"<agent-session-id>",
  "tokens":<int>,"ts":"<iso-time>"}`. The dashboard derives the provider from
  the model name, computes rolling 5h and weekly totals, and shows per-session
  breakdowns. Append-only; cap at the last 200 entries. Costs the coordinator
  nothing extra since it already rewrites the status file on each event.
- The browser polls the server every 2s; that is process-to-process and costs
  ZERO tokens. The model itself only ever does the two blocking waits above.

### Dashboard navigation

The dashboard has a top nav with four views (deep-linkable via URL hash, so
`#graph` opens straight to the graph):

| Nav item | Hash | Shows |
|---|---|---|
| ▦ Board | `#board` | kanban by phase or by domain (the default) |
| ⑂ Task graph | `#graph` | the live DAG, laid out left-to-right by dependency depth |
| ≡ Activity | `#activity` | the event log |
| ◑ Usage & quota | `#usage` | tokens by role + provider 5h/weekly quota bars |

The Task graph view draws itself from each node's `depends_on` array, so the
coordinator MUST include `depends_on` when writing nodes to
`swarm-status.json` or the graph degenerates into one flat column. Columns are
dependency depth (longest path), arrows point from dependency to dependent,
node borders carry state colour (done/running/failed/gate), and each box shows
role · domain · model · tokens with the full detail on hover. Edges into a
running node highlight; edges from an unfinished parent into a still-pending
child render dashed to show what is blocked. Cycles are drawn safely rather
than hanging. The graph re-renders on the same 2s browser poll, so it costs
zero tokens.

### Quota caps (editable in the dashboard)

The dashboard shows a "Provider quota" panel: rolling 5h and weekly token
usage vs configurable caps per provider. Caps live in
`.jcode/swarm-quota.json` (defaults served by serve.py; editable via the ✎
buttons, persisted with POST /api/quota). Metered providers (Anthropic,
OpenAI) get caps; flat-rate subscription providers (zai, alibaba, kimi) show
`∞ included` plus live usage. Anthropic meters messages, not tokens, so caps
are soft guidance; the panel says so. Treat a provider at >=75% of its cap
as a routing signal: bias new nodes to flat-rate providers.

## Before you ask anything

1. Run `swarm list_models` to see which model routes are actually available on
   this machine right now. Never offer a model the user cannot use. ALWAYS show
   the user this live list first and let them pick per role from it. Do NOT
   assume the defaults below; they are only fallbacks if the user says "use
   defaults". New models (e.g. Kimi 3 via `kimi`, models via Ollama Cloud as an
   OpenAI-compatible profile, etc.) appear here automatically once their
   provider is logged in, so this skill never needs editing to support them.
2. Note which are `[unavailable]` (missing credentials) and tell the user which
   `jcode login <provider>` command unblocks the ones they pick. Common ones:
   `zai` (GLM), `kimi` (Kimi Code), `moonshot-ai`, `ollama` (local or point at
   Ollama Cloud via `jcode provider add <name> --base-url ...`).
3. Check whether `./.jcode/swarm-prompt.md` already exists. If it does, read it
   and offer to edit rather than overwrite.

## Model selection is ALWAYS interactive

Every role's model + effort is asked, every run. Present the live
`swarm list_models` output and have the user assign a model to each role. The
"Default:" values in the interview are convenience fallbacks only, used when the
user explicitly says "defaults". This keeps the skill future-proof: whatever
models the user adds later (Kimi 3, new GPT/Claude/GLM versions, an
Ollama-Cloud-backed OpenAI-compatible profile) are selectable without changing
this skill. Record the exact chosen model route per role in the generated
`swarm-prompt.md` (e.g. `kimi:kimi-k2`, `zai:glm-5.2`, `claude-opus-5`).

## The interview

Ask these in a single compact message (let the user answer inline). Offer a
sensible default for each so they can just say "defaults except X".

1. **Brain (planner/architect)** — one model. Default: `claude-fable-5`, effort high.
   This model reads the codebase, resolves ambiguity, and writes the plan. It
   does NOT write code. The brain also emits `contracts.md` (see Contracts
   below) whenever more than one implementer domain exists, and maintains a
   durable `architecture.md` (see Durable knowledge below) so future runs do
   not re-derive the codebase from scratch. Also ask about the SPEC here (see Spec handling below):
   do they have a draft markdown to ingest (cheap, default), should the brain
   generate one, or skip the spec? Get the draft path if they have one. Also ask
   about a DESIGN folder (see Design input below): if they have a Claude
   Design/OpenDesign/Figma/HTML export, it should be run through `/design-ingest`
   first so implementers build from a compact `design.md` contract.
2. **Implementers** — one or more, each with a domain and a model. Ask for the
   domains they need. Common shapes:
   - `backend` implementer
   - `frontend` implementer
   - `mobile` implementer
   Default model for each: `zai:glm-5.2`, effort low.
   ALSO ask REPO TOPOLOGY here (see Repo topology below): is this a monorepo
   (one git tree) or multi-repo (separate folders, each its own git, e.g.
   `api/`, `web/`, `mobile/`)? Get the folder path per domain. This decides each
   implementer's `working_dir` and whether the parallel-writer safety rule
   applies.
3. **Reviewers** — one shared reviewer, or one per implementer. Default: one
   `claude-opus-5` reviewer per implementer (a reviewer never reviews code its
   own implementer model wrote). effort high.
   REVIEWER CONTEXT IS BOUNDED: a reviewer reads the diff, `spec.md`,
   `contracts.md` (and `design.md` for UI domains). It does NOT crawl the
   whole repo; unbounded reviewer context is the main hidden token cost.
4. **Testers (unit/integration)** — optional. One tester per domain or one
   shared. Default model: `zai:glm-5.2` or `claude-sonnet-5` for tricky suites.
   BOUNDARY with TDD implementers: implementers own UNIT tests (they write
   them with the code, that is what /test-driven-development is for). The
   tester owns INTEGRATION tests plus a `/test-gaps` coverage audit. Never
   have both writing unit tests for the same code. Testers do NOT do
   end-to-end QA (that is the QA role below).
5. **QA automation (E2E)** — optional, platform-aware. Ask only for the domains
   the project actually has:
   - **Web QA**: uses jcode's NATIVE `browser` tool plus the `/browser-test`
     skill (Playwright-style: navigate, click, fill, screenshot, assert). No
     install needed. Default model: `claude-sonnet-5` (UI reasoning) or
     `zai:glm-5.2` for cheap runs.
   - **Mobile QA**: jcode has NO native mobile driver and NO installed mobile
     test skill. Recommend **Maestro** (plain-YAML flows, single binary, iOS +
     Android) driven via the `Bash` tool -- it is the most agent-friendly. Note
     Appium as the heavier cross-platform alternative and XCUITest/Espresso as
     native options. The QA agent writes `.yaml` Maestro flows and runs them via
     bash. Tell the user Maestro must be installed on their machine
     (`curl -Ls "https://get.maestro.mobile.dev" | bash`); the swarm cannot
     install it silently.
   QA runs AFTER fix in each branch and checks behavior against `spec.md`.
   QA ENVIRONMENT OWNERSHIP: E2E needs a RUNNING app. Record in the policy an
   `env-up` recipe per QA domain (build, start, seed data, health-check URL or
   simulator boot) and who runs it (the QA node itself, first thing). Never
   let a QA agent discover "connection refused" and debug an environment it
   does not own.
   QA INTENT SUMMARY: besides pass/fail against spec.md, QA writes a 3-5 line
   "does this match what the user actually asked for?" summary for the human,
   because spec.md may itself be an unpolished ingested draft.
6. **Fixer** — who resolves review AND QA findings. Default: the same model as
   the implementer for that domain, effort low.
   RE-REVIEW IS MANDATORY: fixed code goes back to the reviewer for a cheap
   DELTA re-review (the fix diff only) before test/QA. Otherwise the fixer's
   code ships with no approval at all, which silently violates the core
   "writer never approves" rule. Cap the review->fix->re-review loop at 2
   iterations, then escalate per the Escalation section.
7. **Skills per role** — ask which skills each role should always invoke.
   Suggest defaults:
   - Brain: `/brainstorming`, `/make-plan`, `/writing-plans`, `/ponytail`
     (over-engineering originates in the plan; an over-scoped plan makes every
     branch over-engineer in unison)
   - Implementer: `/ponytail` (laziest solution that works, mandatory to counter
     cheap-model over-engineering), `/test-driven-development`, `/using-git-worktrees`
   - Reviewer: `/agent-code-reviewer` (the reviewer persona/agent, jcode's
     equivalent of the Claude Code "Code Reviewer (agent)"),
     `/requesting-code-review`, `/ponytail-review`, `/verification-before-completion`
   - Tester (unit): `/test-driven-development`, `/test-gaps`
   - QA web: `/browser-test` (native browser tool). QA mobile: none installed;
     instruct to write Maestro YAML flows and run via bash.
   - Fixer: `/ponytail`, `/receiving-code-review`, `/systematic-debugging`
8. **Concurrency & visibility** — how many agents may run at once. Default 4.
   Warn that the global cap is 32 but 3-6 is healthiest. Also ask the
   preferred `spawn_mode` and record it in `## Rules`: `inline` (agent chips
   in the session, default), `visible` (a real terminal per agent),
   `headless`, or `auto`. Otherwise visibility silently defaults to inline
   every run.
9. **Escalation & budget** — after how many failed attempts to escalate a node
   to a stronger model. Default: 2 failures escalate -> `claude-sonnet-5`.
   Escalation applies to ANY node type (implementer, reviewer, tester, QA),
   not just implementers, and every node gets a timebox so a HUNG agent is
   detected, not only a failing one. Escalation MUST carry the prior failure
   artifact forward as required reading; re-running a bigger model on the
   same blind prompt pays premium rates to repeat the mistake. Ask what
   happens when a node fails AGAIN after escalation: default is HALT AND ASK
   THE HUMAN. Never burn silently and never silently pass. Also record a
   fallback model per role (used with a warning when the pinned route is
   unavailable, e.g. expired credentials), so the policy does not go stale.
10. **Obsidian vault (optional)** — see Obsidian output below. Ask for a vault
   path if they want artifacts mirrored there; default is no vault.
11. **Diagrams** — the brain emits Mermaid into plan.md (and the Obsidian
   mirror if a vault is set). No extra question needed; Mermaid is the only
   diagram format this skill uses.

## Safety rules you MUST bake into the output

- Concurrency safety depends on REPO TOPOLOGY (see below):
  - MULTI-REPO (each domain its own folder + own git): parallel implementers are
    naturally safe because they write different trees. No worktrees needed.
  - MONOREPO (one tree): implementers writing the SAME files must run
    sequentially OR each in its own git worktree with a distinct `working_dir`.
    Parallel writers to one tree corrupt each other. Say this explicitly.
- The model that wrote code never approves it. This includes the FIXER: fixed
  code gets a delta re-review before test/QA.
- A reviewer reporting `confidence: low` must `inject_gap`, not pass the gate.
- Prefer repo files and typed node artifacts over agent chat.
- HUMAN GATE (default ON): nothing fans out until the human approves `plan.md`
  + `contracts.md`. Approving the plan is the LAST CHEAP moment to stop; after
  fan-out you are paying N branches to be wrong. The user may opt out for
  fully autonomous runs.
- CRITIC PASS: before the human gate, run one cheap adversarial review of
  `plan.md` + `contracts.md` (a different model than the brain, effort low).
  It hunts contradictions, missing dependencies, over-scoping, and interface
  mismatches. A bad plan costs the entire fan-out; this is the highest-ROI
  token spend in the flow.
- INTEGRATION GATE: per-branch QA passing is NOT done. Add a terminal
  `integration` node with `depends_on` on ALL branch QA nodes that exercises
  the seams between domains (frontend against real backend, mobile against
  real backend) after merge. "Done" means the integration gate passed.
- ROLLBACK: define it before you need it. Multi-repo means multiple PRs; the
  policy names the revert order (consumers before providers: mobile/web PRs
  revert before the api PR) and who decides (the human, prompted by the
  integration gate failing twice).
- COST TELEMETRY: after each `run_plan`, run `/cost-report` per role and
  append the numbers to a short `costs.md`. Two runs of data shows whether
  the cheap-implementer/expensive-reviewer split actually holds and which
  role to re-route.

## Contracts (required when more than one implementer domain exists)

Parallel domains fail most often not inside a branch but BETWEEN branches:
backend and frontend each build something "correct" against prose in spec.md,
and the two do not fit together. Prose is not an interface.

- The brain emits `contracts.md` alongside `plan.md`: endpoints, request and
  response payloads, error shapes, shared types, events. Concrete examples,
  not descriptions.
- Every implementer whose domain touches a contract builds AGAINST it.
  Reviewers check the diff against it.
- Changing a contract is a RE-PLANNING event (back to the brain, human gate
  re-approves), never a unilateral edit by one branch.
- Single-domain projects may skip contracts.md.

## Durable knowledge (architecture.md)

Only `constitution.md` survives across runs by default, so run 2 pays to
re-derive everything the brain learned in run 1. Fix: the brain maintains
`architecture.md` (folder map, key modules, data flow, gotchas). On each new
run it READS and UPDATES this file instead of re-exploring the codebase from
scratch. It pays for itself by the third run.

## Repo topology (monorepo vs multi-repo)

Ask the user which they have; the default here is MULTI-REPO since the user
usually keeps `api/`, `web/`, `mobile/` as separate repos and only sometimes
uses a monorepo.

- MULTI-REPO (default): each domain is its own folder with its own git. Give
  each implementer (and its reviewer/tester/QA) a `working_dir` pointing at that
  domain's folder. Each branch commits to its own git and opens its own PR.
  Because trees are disjoint, all domain branches run in PARALLEL with no
  worktree gymnastics. This is the easier, safer case.
- MONOREPO: one git tree containing all domains (e.g. packages/). Implementers
  that touch shared files must sequence or use git worktrees with distinct
  `working_dir`s. Apply the parallel-writer rule above.

Shared coordination artifacts (constitution/spec/plan/tasks/design) need a home:
- MULTI-REPO: put them in a dedicated coordinator folder (the directory where
  `/swarm-setup-agent-skill` runs, or a small `project-control/` repo) rather than
  duplicating across the domain repos. Each domain repo may keep a short
  `AGENTS.md` pointer back to it. Record this location in `## Artifacts`.
- MONOREPO: keep them in `./.jcode/` at the repo root as normal.

Record the topology, each domain's folder path, and each role's `working_dir` in
the generated `swarm-prompt.md` under a `## Repos` section.

## Spec handling (spec-kit-inspired, no install, token-aware)

This skill borrows spec-kit's discipline (constitution -> spec -> plan -> tasks
as plain markdown artifacts) but installs nothing and depends on nothing. The
artifacts are ordinary `.md` files in `./.jcode/` or a `./specs/` folder.

Writing a spec from scratch with the brain model is the single most expensive
output in the whole flow. Many users already brainstorm a spec for free in
ChatGPT/Grok/etc and hand over a draft `.md`. So you MUST offer a choice and
default to the cheap path. Ask the user which mode they want:

1. **Ingest my draft (cheap, default).** The user provides a path to an existing
   markdown spec/feature doc. The brain does NOT rewrite it. It runs a cheap
   validation-and-gap pass only: read the draft, list missing/ambiguous items as
   a short checklist, and ask the user to fill gaps OR approve as-is. Then it
   copies/normalizes the draft to `spec.md` unchanged except for a small
   `## Open questions` section appended. Keep brain effort LOW for this mode.

2. **Generate from scratch (expensive, opt-in).** Only when the user has no
   draft. Brain effort high. Author `spec.md` from the interview.

3. **Skip spec entirely.** Some tasks are small. Allow going straight to plan.

The constitution (`constitution.md`, durable project principles) is written once
and reused. If it already exists, never regenerate it, just reference it.

## Design input (optional, pairs with the /design-ingest skill)

Many projects start from a prototype/wireframe/hi-fi design folder (Claude
Design, OpenDesign, Figma export, HTML/CSS). Do NOT have implementers re-parse
that raw folder every session -- that is slow and token-heavy, and it is a big
reason "coding takes time". Instead:

- Ask if the user has a design output folder.
- If yes and it has NOT been ingested: run (or tell them to run) the
  `/design-ingest` skill first. It reads the folder ONCE and produces compact
  `design.md` + `tokens.md` in `./.jcode/design/`.
- If `./.jcode/design/design.md` already exists: just reference it. Never
  re-read the raw folder.
- If no design folder: skip; implementers work from spec.md alone.

Wire the design contract to the RIGHT roles: `design.md` + `tokens.md` are
required reading for the `frontend` and `mobile` implementers (and their
reviewers, who check the UI against them). The `backend` implementer usually
does not need them. Record the design artifact paths in the generated
`swarm-prompt.md` under `## Artifacts`, and add a rule that frontend/mobile build
against `design.md`/`tokens.md` rather than the raw design folder.

## Obsidian output (optional, thin, zero extra token cost)

Obsidian is a HUMAN reading layer, not an agent coordination layer. Agents still
coordinate via files and typed artifacts; Obsidian just makes the same markdown
browsable, linkable, and graph-viewable for the user. Ask ONE question: do they
want artifacts written into an Obsidian vault, and if so the vault path.

- If NO vault path: write artifacts to `./.jcode/` as normal. No coupling.
- If a vault path is given: write the artifacts into `<vault>/<project>/` using
  Obsidian-friendly conventions, which cost only a handful of extra tokens per
  file (writing wikilinks + frontmatter, not reading anything):
  - YAML frontmatter on each note: `tags`, `status` (draft/active/done),
    `date`, `project`, so Dataview can index them.
  - `[[wikilinks]]` connecting the chain: constitution <-> spec <-> plan <->
    tasks <-> review notes.
  - A per-project index note `<project>.md` linking all artifacts and a short
    status line.
  - Optionally an Obsidian Canvas (`.canvas` JSON) rendering the task graph as a
    visual board, since jcode itself has no graphical kanban/Gantt.

Do NOT make Obsidian a memory store. jcode has native semantic memory; a second
competing store is an anti-pattern. Obsidian is for the user to read, not for
agents to depend on. Writing notes burns no meaningful tokens. Only an Obsidian
MCP that READS the vault into model context would cost tokens; that is a
separate, explicitly opt-in integration and NOT part of this skill's defaults.

## Diagrams (Mermaid only)

Diagrams for architecture, screens, user flows (mobile + web), backend/data
model, and the skill/swarm flow itself. Use MERMAID. Never coordinate-drawing.

Why Mermaid:
- The brain/planner writes a few lines of text; layout is automatic.
- jcode renders Mermaid natively, and Obsidian renders it too, so diagrams show
  up for free inside plan.md and the vault notes.
- Token cost is near-zero.

So the brain MUST emit Mermaid diagrams into `plan.md` (and the Obsidian mirror
if a vault is set) for:
- App architecture -> `flowchart` or `graph`
- User flows (mobile/web) -> `flowchart` / `stateDiagram-v2`
- Backend / data model -> `erDiagram` and `sequenceDiagram`
- Skill/swarm flow -> `flowchart`

Record the chosen spec mode and the draft path (if any) in the generated
`swarm-prompt.md` under a `## Spec` section, so every future session knows to
read the existing spec instead of re-authoring it. Reviewers and testers MUST
check their work against `spec.md`, not just for generic code quality.

The artifact chain (all plain markdown, all optional except where noted):

  constitution.md  (once, durable principles)
  architecture.md  (durable codebase map -- brain UPDATES it, never re-derives)
        v
  spec.md          (what + why -- ingested draft OR generated OR skipped)
  design.md        (what it looks like -- from /design-ingest, optional)
  tokens.md        (design tokens -- from /design-ingest, optional)
        v
  plan.md          (brain: tech approach + Mermaid)
  contracts.md     (brain: API/interface contract -- required for multi-domain)
        v
  critic pass      (cheap adversarial review of plan + contracts)
  HUMAN GATE       (last cheap moment to stop; approve plan + contracts)
        v
  tasks.md         (brain: the DAG that seeds swarm task_graph)
        v
  fan out per domain -> review (diff vs spec+contracts+design) -> fix
    -> delta re-review -> test (integration) -> env-up -> QA (+ intent summary)
        v
  integration gate (seams between domains) -> ship | rollback | budget halt
  costs.md         (per-role /cost-report numbers after each run)

## Writing the file

Write `./.jcode/swarm-prompt.md`. Structure it as clear imperative instructions
(it is injected as a prompt, not parsed as config). Include:

- A `## Roles` section: each role with its model, effort, required skills, and
  a fallback model to use (with a warning) if the pinned route is unavailable.
- A `## Repos` section: topology (monorepo / multi-repo), each domain's folder
  path, each role's `working_dir`, and whether branches run parallel (multi-repo)
  or need sequencing/worktrees (monorepo shared files).
- A `## Spec` section: chosen spec mode (ingest-draft / generate / skip), the
  draft path if any, and the rule that reviewers/testers check against spec.md.
- A `## Contracts` section (multi-domain only): contracts.md is binding, brain
  authors it, implementers build against it, changes are re-planning events.
- A `## Artifacts` section: which markdown files this project uses
  (constitution.md / architecture.md / spec.md / contracts.md / plan.md /
  tasks.md / costs.md) and where they live. If an
  Obsidian vault was given, record the vault path here and the rule to mirror
  artifacts as linked notes with frontmatter (never as a memory store).
- A `## Diagrams` section: Mermaid only. The brain emits Mermaid into plan.md
  (and the Obsidian mirror if a vault is set).
- A `## Team graph` section: an ASCII sketch of the fan-out
  (brain -> critic -> human gate -> [backend, frontend, mobile] ->
  review -> fix -> re-review -> test -> env-up -> QA -> integration gate).
- A `## QA environments` section: the env-up recipe per QA domain.
- A `## Rules` section with the safety rules above, the concurrency limit, and
  the chosen `spawn_mode`.
- A `## Escalation` section: threshold, target model, carry-failure-forward,
  timeboxes, and the halt-and-ask-human terminal state.
- A `## Rollback` section: revert order across PRs and who decides.
- A header comment naming the project and the date.

After writing, print:
- The exact file path.
- Any `jcode login` commands needed for chosen-but-unavailable models.
- A one-line reminder that a fresh session picks it up automatically, and to
  commit the file so teammates share the policy.
- Offer to run a small live test with `swarm task_graph` + `swarm run_plan`.

## Example generated file (backend + frontend + mobile team)

```markdown
<!-- Swarm policy for <project> — generated <date> -->

## Roles

- BRAIN (plan/architect): claude-fable-5, effort high. Fallback: claude-sonnet-5.
  Skills: /brainstorming, /make-plan, /ponytail. Writes plan.md + contracts.md,
  updates architecture.md. Never writes code.
- CRITIC: claude-sonnet-5, effort low. Adversarial pass over plan.md +
  contracts.md before the human gate. Hunts contradictions, over-scope,
  interface mismatches.
- IMPLEMENTER:backend: zai:glm-5.2, effort low. Fallback: claude-sonnet-5.
  Skills: /ponytail, /test-driven-development. Owns unit tests.
- IMPLEMENTER:frontend: zai:glm-5.2, effort low. Fallback: claude-sonnet-5.
  Skills: /ponytail, /test-driven-development. Owns unit tests. Builds against
  contracts.md + design.md.
- IMPLEMENTER:mobile: zai:glm-5.2, effort low. Fallback: claude-sonnet-5.
  Skills: /ponytail, /test-driven-development. Owns unit tests. Builds against
  contracts.md + design.md.
- REVIEWER (one per implementer): claude-opus-5, effort high.
  Context: diff + spec.md + contracts.md (+ design.md for UI). Never the whole repo.
  Skills: /agent-code-reviewer, /requesting-code-review, /ponytail-review, /verification-before-completion.
- TESTER (integration + /test-gaps audit, per domain): claude-sonnet-5, effort medium.
- QA:web (E2E): claude-sonnet-5, effort medium. Native browser tool + /browser-test.
  env-up first: npm run dev in ./web, health-check http://localhost:3000.
- QA:mobile (E2E): claude-sonnet-5, effort medium. Maestro YAML flows via bash.
  env-up first: build app, boot simulator.
- FIXER: same model as the failing branch's implementer, effort low.
  Skills: /ponytail, /receiving-code-review, /systematic-debugging.
  Fixed diffs go back to the reviewer for delta re-review. Max 2 loops.

## Team graph

  BRAIN (fable-5) --> CRITIC (sonnet, cheap) --> HUMAN GATE (approve plan+contracts)
    |
    +-- backend  (glm) --> review (opus) --> fix (glm) --> re-review --> test --> qa:api
    +-- frontend (glm) --> review (opus) --> fix (glm) --> re-review --> test --> qa:web    (browser tool)
    +-- mobile   (glm) --> review (opus) --> fix (glm) --> re-review --> test --> qa:mobile (Maestro YAML)
    |
  INTEGRATION GATE (seams: web+mobile against real api) --> ship | rollback

## Rules

- Run swarm in deep mode. depends_on enforces order; artifacts carry
  findings, what_i_did_not_check, and confidence.
- The model that wrote code never approves it. Fixer output gets delta re-review.
- A reviewer with confidence: low must inject_gap, not pass.
- contracts.md is binding; changing it is a re-planning event.
- Implementers editing shared files run sequentially or in separate git
  worktrees with distinct working_dir. Never parallel-write one tree.
- Concurrency limit 4. spawn_mode: inline. Prefer repo files/artifacts over agent chat.
- QA writes a 3-5 line intent summary for the human, not just pass/fail.
- After each run_plan: /cost-report per role, append to costs.md.

## Escalation

- 2 failed attempts on ANY node escalate it to claude-sonnet-5, carrying the
  failure artifact forward as required reading.
- Per-node timebox: 30 min; a hung node counts as a failed attempt.
- If a node fails again after escalation: HALT and ask the human.

## Rollback

- Integration gate fails twice -> halt. Revert order: mobile PR, web PR, then
  api PR (consumers before providers). The human decides; agents propose.
```
