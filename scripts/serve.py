#!/usr/bin/env python3
"""swarm-setup-agent-skill live server: interview form + kanban dashboard.

Stdlib only. Token-free by design: the model launches this once in the
background and does ONE blocking wait; the browser does all the polling.

Usage:
    python3 serve.py [--port 7777] [--project-dir .] [--state-dir .swarm]

Host-agnostic: works under jcode, Claude Code, pi, opencode, codex, or no host
at all. The state directory is auto-detected (an existing .jcode/ or .swarm/,
else .swarm/) and can be forced with --state-dir or $SWARM_STATE_DIR.

Endpoints:
    GET  /                      -> interview form (assets/interview.html)
    GET  /dashboard             -> kanban dashboard (assets/dashboard.html)
    GET  /api/skills            -> all installed skills (scanned live)
    GET  /api/models            -> available models (<state>/swarm-models.json)
    GET  /api/status            -> <state>/swarm-status.json (dashboard poll)
    GET  /api/answers           -> existing <state>/swarm-answers.json if any
    GET  /api/quota             -> provider caps (<state>/swarm-quota.json or defaults)
    POST /api/quota             -> update one provider's caps {provider, cap_5h, cap_week, ...}
    POST /api/answers           -> write <state>/swarm-answers.json + touch .submitted flag
    POST /api/approve           -> write <state>/swarm-approval.json {approved|rejected, note}
    GET  /api/wait?file=X&timeout=N  (long-poll used by curl, NOT the model)

The agent waits with a single bash call:
    python3 serve.py --wait-for answers --timeout 3600
which blocks until <state>/swarm-answers.submitted appears (exit 0) or times
out (exit 1). Same for --wait-for approval.
"""
import argparse
import json
import os
import re
import shutil
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "assets"

HOME = Path.home()

# Every agent host we know how to read skills from. Unknown/absent paths are
# skipped, so adding a host here is free.
SKILL_DIRS = [
    HOME / ".jcode" / "skills",            # jcode
    HOME / ".claude" / "skills",           # Claude Code
    HOME / ".config" / "opencode" / "skills",  # opencode
    HOME / ".codex" / "skills",            # codex
    HOME / ".pi" / "agent" / "skills",     # pi
    HOME / ".pi" / "skills",
    HOME / ".agents" / "skills",           # shared convention
    HOME / ".config" / "agents" / "skills",
    Path(".jcode") / "skills",             # project-local, any host
    Path(".claude") / "skills",
    Path(".opencode") / "skills",
    Path(".agents") / "skills",
    Path(".swarm") / "skills",
]

# host id -> (CLI binary, config/skill home, policy file the host auto-loads)
HOSTS = {
    "jcode":    {"bin": "jcode",        "home": ".jcode",          "policy": ".jcode/swarm-prompt.md",
                 "login": "jcode login <provider>", "native_swarm": True},
    "claude":   {"bin": "claude",       "home": ".claude",         "policy": "CLAUDE.md",
                 "login": "claude /login", "native_swarm": False},
    "opencode": {"bin": "opencode",     "home": ".config/opencode", "policy": "AGENTS.md",
                 "login": "opencode auth login", "native_swarm": False},
    "codex":    {"bin": "codex",        "home": ".codex",          "policy": "AGENTS.md",
                 "login": "codex login", "native_swarm": False},
    "pi":       {"bin": "pi",           "home": ".pi",             "policy": "AGENTS.md",
                 "login": "pi auth login", "native_swarm": False},
    "cursor":   {"bin": "cursor-agent", "home": ".cursor",         "policy": "AGENTS.md",
                 "login": "cursor-agent login", "native_swarm": False},
}


def detect_hosts():
    """Which agent CLIs are actually installed on this machine."""
    out = []
    for hid, h in HOSTS.items():
        path = shutil.which(h["bin"])
        if path or (HOME / h["home"]).is_dir():
            out.append({"id": hid, "bin": h["bin"], "installed": bool(path),
                        "path": path, "policy": h["policy"],
                        "login": h["login"], "native_swarm": h["native_swarm"]})
    return out


def resolve_state_dir(project_dir: Path, explicit=None) -> Path:
    """Where swarm-*.json lives. Host-neutral, with jcode back-compat.

    Order: --state-dir, $SWARM_STATE_DIR, an existing .jcode/ or .swarm/ in the
    project, else .swarm/.
    """
    name = explicit or os.environ.get("SWARM_STATE_DIR")
    if name:
        p = Path(name)
        return p if p.is_absolute() else project_dir / p
    for cand in (".jcode", ".swarm"):
        if (project_dir / cand).is_dir():
            return project_dir / cand
    return project_dir / ".swarm"


def scan_skills():
    """Scan skill folders for SKILL.md frontmatter: name + description."""
    seen = {}
    for base in SKILL_DIRS:
        if not base.is_dir():
            continue
        for d in sorted(base.iterdir()):
            md = d / "SKILL.md"
            if not d.is_dir() or not md.is_file() or d.name in seen:
                continue
            desc = ""
            try:
                head = md.read_text(errors="ignore")[:2000]
                m = re.search(r"^description:\s*(.+)$", head, re.M)
                if m:
                    desc = m.group(1).strip()[:180]
            except OSError:
                pass
            seen[d.name] = {"name": "/" + d.name, "description": desc}
    return sorted(seen.values(), key=lambda s: s["name"])


def load_models(state_dir: Path):
    """Models come from <state>/swarm-models.json, written by the agent from a
    live model listing before launching the server. Falls back to a minimal
    static list so the form still works standalone."""
    for p in (state_dir / "swarm-models.json",
              HOME / ".jcode" / "swarm-models.json",
              HOME / ".swarm" / "swarm-models.json"):
        if p.is_file():
            try:
                return json.loads(p.read_text())
            except (OSError, json.JSONDecodeError):
                pass
    return {"generated": None, "note": "fallback list; agent did not export live models",
            "models": [
                {"route": "claude-fable-5", "available": True},
                {"route": "claude-opus-5", "available": True},
                {"route": "claude-sonnet-5", "available": True},
                {"route": "gpt-5.5", "available": True},
                {"route": "zai:glm-5.2", "available": False, "login": "<host> login zai"},
                {"route": "kimi:kimi-k2", "available": False, "login": "<host> login kimi"},
            ]}


QUOTA_DEFAULTS = {
    "_note": "Caps are in tokens over rolling windows (5h / 7d). Anthropic meters "
             "messages, not tokens, so metered caps are soft guidance: tune after real runs.",
    "providers": {
        "anthropic": {"metered": True, "cap_5h": 2500000, "cap_week": 12000000,
                      "plan": "Claude $100 plan", "note": "soft cap estimate"},
        "zai": {"metered": False, "plan": "GLM subscription"},
        "alibaba": {"metered": False, "plan": "Alibaba Cloud Coding Plan"},
        "kimi": {"metered": False, "plan": "Kimi subscription"},
        "openai": {"metered": True, "cap_5h": None, "cap_week": None,
                   "note": "no credentials"},
    }
}


def load_quota(state_dir: Path):
    p = state_dir / "swarm-quota.json"
    if p.is_file():
        try:
            return json.loads(p.read_text())
        except (OSError, json.JSONDecodeError):
            pass
    return QUOTA_DEFAULTS


class Handler(BaseHTTPRequestHandler):
    project_dir = Path(".")
    state_dir = Path(".swarm")
    MAX_BODY = 2 * 1024 * 1024  # 2 MB is plenty for any answers/quota payload

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _local_request(self):
        """CSRF / DNS-rebinding guard for state-changing requests.

        The server is loopback-only, but a malicious web page in the user's
        browser could still POST to http://127.0.0.1:<port>/api/approve and
        auto-approve the human gate. Browsers always attach an Origin header
        to cross-origin POSTs, so: reject any Origin/Host that is not
        localhost. Requests without Origin (curl, the agent) are allowed.
        """
        host = (self.headers.get("Host") or "")
        host = host.split("]")[0] + "]" if host.startswith("[") else host.split(":")[0]
        if host not in ("127.0.0.1", "localhost", "[::1]", ""):
            return False
        origin = self.headers.get("Origin")
        if origin:
            m = re.match(r"https?://(\[[^\]]+\]|[^/:]+)", origin)
            if not m or m.group(1) not in ("127.0.0.1", "localhost", "[::1]"):
                return False
        return True

    def _file(self, name):
        p = ASSETS / name
        if p.is_file():
            self._send(200, p.read_bytes(), "text/html; charset=utf-8")
        else:
            self._send(404, {"error": f"missing asset {name}"})

    def _json_path(self, name):
        return self.state_dir / name

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ("/", "/interview"):
            self._file("interview.html")
        elif path == "/dashboard":
            self._file("dashboard.html")
        elif path == "/api/skills":
            self._send(200, scan_skills())
        elif path == "/api/models":
            self._send(200, load_models(self.state_dir))
        elif path == "/api/quota":
            self._send(200, load_quota(self.state_dir))
        elif path == "/api/hosts":
            self._send(200, {"hosts": detect_hosts(),
                             "state_dir": str(self.state_dir)})
        elif path in ("/api/status", "/api/answers", "/api/approval"):
            p = self._json_path("swarm-" + path.rsplit("/", 1)[1] + ".json")
            if p.is_file():
                try:
                    self._send(200, json.loads(p.read_text()))
                except (OSError, json.JSONDecodeError):
                    self._send(500, {"error": "unreadable"})
            else:
                self._send(200, {})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._local_request():
            return self._send(403, {"error": "cross-origin request rejected"})
        try:
            n = int(self.headers.get("Content-Length", 0))
        except ValueError:
            return self._send(400, {"error": "bad content-length"})
        if n > self.MAX_BODY:
            return self._send(413, {"error": "body too large"})
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"error": "bad json"})
        jdir = self.state_dir
        jdir.mkdir(parents=True, exist_ok=True)
        if self.path == "/api/quota":
            q = load_quota(self.state_dir)
            prov = body.get("provider")
            if prov:
                merged = q.setdefault("providers", {}).get(prov, {})
                merged.update({k: v for k, v in body.items() if k != "provider"})
                q["providers"][prov] = merged
            (jdir / "swarm-quota.json").write_text(json.dumps(q, indent=2))
            self._send(200, {"ok": True, "path": str(jdir / "swarm-quota.json")})
        elif self.path == "/api/answers":
            (jdir / "swarm-answers.json").write_text(json.dumps(body, indent=2))
            (jdir / "swarm-answers.submitted").write_text(str(time.time()))
            self._send(200, {"ok": True, "path": str(jdir / "swarm-answers.json")})
        elif self.path == "/api/approve":
            (jdir / "swarm-approval.json").write_text(json.dumps(body, indent=2))
            (jdir / "swarm-approval.submitted").write_text(str(time.time()))
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "not found"})

    def log_message(self, *a):  # quiet
        pass


def wait_for(state_dir: Path, what: str, timeout: int) -> int:
    """Blocking wait used by the AGENT in one bash call (token-efficient)."""
    flag = state_dir / f"swarm-{what}.submitted"
    if flag.exists():
        flag.unlink()  # stale flag from a previous run
    deadline = time.time() + timeout
    while time.time() < deadline:
        if flag.exists():
            print(f"{what} received: {state_dir / ('swarm-' + what + '.json')}")
            return 0
        time.sleep(1)
    print(f"timeout waiting for {what}", file=sys.stderr)
    return 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=7777)
    ap.add_argument("--project-dir", default=".")
    ap.add_argument("--state-dir", default=None,
                    help="where swarm-*.json lives (default: existing .jcode/ or .swarm/)")
    ap.add_argument("--wait-for", choices=["answers", "approval"])
    ap.add_argument("--timeout", type=int, default=3600)
    ap.add_argument("--detect-hosts", action="store_true",
                    help="print the agent CLIs installed here and exit")
    args = ap.parse_args()
    project = Path(args.project_dir).resolve()
    state = resolve_state_dir(project, args.state_dir)

    if args.detect_hosts:
        print(json.dumps({"state_dir": str(state), "hosts": detect_hosts()}, indent=2))
        return

    if args.wait_for:
        sys.exit(wait_for(state, args.wait_for, args.timeout))

    Handler.project_dir = project
    Handler.state_dir = state
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"swarm-setup-agent-skill server on http://127.0.0.1:{args.port}"
          f"  (project: {project}, state: {state})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
