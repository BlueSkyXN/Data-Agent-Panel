from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import textwrap
import time
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from .. import db
from ..config import get_settings
from . import trace_service

settings = get_settings()


def _json(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, indent=2)


def _event(task_id: str, mode: str, event_type: str, content: Any) -> None:
    try:
        db.insert("codex_runtime_events", {
            "id": db.new_id("cevt"),
            "task_id": task_id,
            "mode": mode,
            "event_type": event_type,
            "content": content if isinstance(content, str) else json.dumps(content, ensure_ascii=False),
            "created_at": db.now(),
        })
    except Exception:
        # Event logging must never break the dispatch path.
        pass


def runtime_diagnostics() -> dict[str, Any]:
    """Return local Codex runtime status without executing any task."""
    cli_path = shutil.which(settings.codex_cli_command)
    cli_version = ""
    cli_error = ""
    if cli_path:
        try:
            proc = subprocess.run([settings.codex_cli_command, "--version"], capture_output=True, text=True, timeout=8, check=False)
            cli_version = (proc.stdout or proc.stderr or "").strip()
        except Exception as exc:
            cli_error = str(exc)
    sdk_found = importlib.util.find_spec(settings.codex_sdk_python_module) is not None
    return {
        "mode_default": settings.codex_mode,
        "handoff_dir": str(settings.codex_task_dir),
        "workspace_root": str(settings.codex_workspace_root),
        "cli": {
            "enabled": settings.codex_cli_enabled,
            "command": settings.codex_cli_command,
            "path": cli_path,
            "version": cli_version,
            "error": cli_error,
            "sandbox": settings.codex_cli_sandbox,
            "approval_policy": settings.codex_cli_approval_policy,
            "profile": settings.codex_cli_profile,
            "model": settings.codex_cli_model,
        },
        "sdk": {
            "enabled": settings.codex_sdk_enabled,
            "python_module": settings.codex_sdk_python_module,
            "module_found": sdk_found,
            "model": settings.codex_sdk_model,
            "note": "Python SDK is optional. Install Codex SDK from the local open-source Codex repo before enabling sdk mode.",
        },
        "http": {
            "endpoint_configured": bool(settings.codex_endpoint),
            "endpoint": settings.codex_endpoint if settings.app_env != "production" else "<redacted>",
        },
    }


def build_codex_prompt(title: str, task_prompt: str, workspace: dict[str, Any] | None, acceptance: list[str], context: dict[str, Any] | None = None) -> str:
    workspace = workspace or {}
    context = context or {}
    prompt = f"""
# Data Agent Platform Codex Engineering Task

## Title
{title}

## Objective
{task_prompt.strip()}

## Repository Context
- repo_path: {workspace.get('repo_path') or '<configured by platform>'}
- default_branch: {workspace.get('default_branch') or 'main'}
- allowed_paths: {workspace.get('allowed_paths') or '[]'}
- test_command: {workspace.get('test_command') or '<not configured>'}

## Required Workflow
1. Read `AGENTS.md` first if present.
2. Inspect current code before editing.
3. Produce the smallest safe diff that satisfies the task.
4. Keep platform guarantees: RBAC, SQL Guard, Trace, approval flow, audit log, and evaluation records.
5. Run or update tests listed below.
6. Summarize changed files, validation results, risks, and remaining manual checks.

## Acceptance Criteria
{chr(10).join([f'- {x}' for x in acceptance]) if acceptance else '- Implement safely and keep existing smoke/security tests passing.'}

## Guardrails
- Do not remove existing security checks, RBAC, SQL Guard, Trace, audit logging, or approval flows.
- Do not hard-code production secrets, tokens, internal hostnames, or real credentials.
- Do not execute destructive database or filesystem operations.
- Prefer additive, backwards-compatible API responses.
- If implementation is risky, stop after preparing a plan and ask for human review.

## Platform Context
```json
{_json(context)}
```
""".strip()
    return prompt[: settings.codex_max_prompt_chars]


def create_task(payload: dict[str, Any], user: dict, trace_id: str | None = None) -> dict[str, Any]:
    workspace = db.one("SELECT * FROM codex_workspaces WHERE id=?", [payload.get("workspace_id") or "codex_ws_data_agent_platform"])
    if workspace and isinstance(workspace.get("allowed_paths"), str):
        try:
            workspace["allowed_paths"] = json.loads(workspace["allowed_paths"])
        except Exception:
            pass
    acceptance = payload.get("acceptance_criteria") or [
        "需求拆解为清晰代码变更点。",
        "保留现有安全护栏、Trace 和审计能力。",
        "补充或更新测试脚本。",
        "提交结果必须包含变更摘要和验证方法。",
    ]
    prompt = build_codex_prompt(payload["title"], payload["task_prompt"], workspace, acceptance, payload.get("context") or {})
    task_id = db.new_id("codex")
    now = db.now()
    requires = 1 if payload.get("requires_approval", settings.codex_require_approval_default) else 0
    status = "awaiting_approval" if requires else "ready"
    db.insert("codex_tasks", {
        "id": task_id,
        "title": payload["title"],
        "workspace_id": payload.get("workspace_id") or (workspace["id"] if workspace else None),
        "source_agent_id": payload.get("source_agent_id"),
        "trace_id": trace_id or payload.get("trace_id"),
        "requester_id": user["id"],
        "task_prompt": prompt,
        "acceptance_criteria": acceptance,
        "mode": payload.get("mode") or settings.codex_mode,
        "status": status,
        "risk_level": payload.get("risk_level") or "medium",
        "requires_approval": requires,
        "approved_by": None,
        "result_summary": "",
        "result_json": {},
        "dispatch_attempts": 0,
        "last_dispatch_at": None,
        "execution_log_path": "",
        "sdk_thread_id": "",
        "created_at": now,
        "updated_at": now,
    })
    _event(task_id, payload.get("mode") or settings.codex_mode, "created", {"status": status})
    if trace_id:
        trace_service.add_step(trace_id, "codex", "create_codex_task", {"title": payload["title"]}, {"codex_task_id": task_id, "status": status})
    write_handoff_artifact(task_id)
    return get_task(task_id) or {}


def get_task(task_id: str) -> dict[str, Any] | None:
    task = db.one("SELECT * FROM codex_tasks WHERE id=?", [task_id])
    if not task:
        return None
    for key in ["acceptance_criteria", "result_json"]:
        try:
            task[key] = json.loads(task.get(key) or ([] if key == "acceptance_criteria" else {}))
        except Exception:
            pass
    task["artifacts"] = db.many("SELECT * FROM codex_artifacts WHERE task_id=? ORDER BY created_at", [task_id])
    task["events"] = db.many("SELECT * FROM codex_runtime_events WHERE task_id=? ORDER BY created_at", [task_id])
    task["workspace"] = db.one("SELECT * FROM codex_workspaces WHERE id=?", [task.get("workspace_id")]) if task.get("workspace_id") else None
    return task


def list_events(task_id: str) -> list[dict[str, Any]]:
    return db.many("SELECT * FROM codex_runtime_events WHERE task_id=? ORDER BY created_at", [task_id])


def write_handoff_artifact(task_id: str) -> Path:
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Codex task not found")
    settings.codex_task_dir.mkdir(parents=True, exist_ok=True)
    path = settings.codex_task_dir / f"{task_id}.md"
    path.write_text(task["task_prompt"], encoding="utf-8")
    if not db.many("SELECT id FROM codex_artifacts WHERE task_id=? AND artifact_type='handoff_md'", [task_id]):
        db.insert("codex_artifacts", {"id": db.new_id("cxa"), "task_id": task_id, "artifact_type": "handoff_md", "path": str(path), "content": "", "created_at": db.now()})
    _event(task_id, task.get("mode") or "mock", "handoff_written", {"path": str(path)})
    return path


def approve_task(task_id: str, user: dict, comment: str = "") -> dict[str, Any]:
    task = db.one("SELECT * FROM codex_tasks WHERE id=?", [task_id])
    if not task:
        raise HTTPException(status_code=404, detail="Codex task not found")
    db.update("codex_tasks", "id", task_id, {"status": "ready", "approved_by": user["id"], "updated_at": db.now(), "result_summary": comment or task.get("result_summary") or "已审批，等待派发。"})
    _event(task_id, task.get("mode") or "mock", "approved", {"approved_by": user["id"], "comment": comment})
    if task.get("trace_id"):
        trace_service.add_step(task["trace_id"], "codex", "approve_codex_task", {"task_id": task_id}, {"approved_by": user["id"], "comment": comment})
    return get_task(task_id) or {}


def dispatch_task(task_id: str, user: dict, mode: str | None = None) -> dict[str, Any]:
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Codex task not found")
    if task["status"] not in {"ready", "draft"}:
        raise HTTPException(status_code=400, detail=f"Codex task status does not allow dispatch: {task['status']}")
    dispatch_mode = mode or task.get("mode") or settings.codex_mode
    start = time.time()
    _event(task_id, dispatch_mode, "dispatch_started", {"user_id": user.get("id")})
    if dispatch_mode == "mock":
        result = {"mode": "mock", "message": "已生成 Codex 交接包。真实执行请切换到 http、cli 或 sdk，并在企业环境配置审批和凭证。", "handoff_file": str(write_handoff_artifact(task_id))}
    elif dispatch_mode == "http":
        result = _dispatch_http(task)
    elif dispatch_mode == "cli":
        result = _dispatch_cli(task)
    elif dispatch_mode == "sdk":
        result = _dispatch_sdk(task)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported Codex dispatch mode: {dispatch_mode}")
    duration = int((time.time() - start) * 1000)
    status = "completed" if result.get("ok") else "dispatched"
    if result.get("returncode") not in (None, 0):
        status = "failed"
    db.update("codex_tasks", "id", task_id, {
        "status": status,
        "mode": dispatch_mode,
        "result_summary": result.get("message") or result.get("summary") or "已派发",
        "result_json": result,
        "dispatch_attempts": int(task.get("dispatch_attempts") or 0) + 1,
        "last_dispatch_at": db.now(),
        "execution_log_path": result.get("log_path") or task.get("execution_log_path") or "",
        "sdk_thread_id": result.get("thread_id") or task.get("sdk_thread_id") or "",
        "updated_at": db.now(),
    })
    _event(task_id, dispatch_mode, "dispatch_finished", {"duration_ms": duration, **result})
    if task.get("trace_id"):
        trace_service.add_step(task["trace_id"], "codex", "dispatch_codex_task", {"task_id": task_id, "mode": dispatch_mode}, {"duration_ms": duration, **result})
    return get_task(task_id) or {}


def _dispatch_http(task: dict[str, Any]) -> dict[str, Any]:
    endpoint = settings.codex_endpoint
    if not endpoint:
        return {"mode": "http", "ok": False, "message": "DAP_CODEX_ENDPOINT 未配置，已保留为 handoff 文件。", "handoff_file": str(write_handoff_artifact(task["id"]))}
    body = json.dumps({"task_id": task["id"], "title": task["title"], "prompt": task["task_prompt"], "workspace": task.get("workspace")}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(endpoint, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            data.setdefault("mode", "http")
            data.setdefault("ok", True)
            return data
    except Exception as exc:
        return {"mode": "http", "ok": False, "message": f"Codex HTTP 派发失败：{exc}", "handoff_file": str(write_handoff_artifact(task["id"]))}


def _dispatch_cli(task: dict[str, Any]) -> dict[str, Any]:
    handoff = write_handoff_artifact(task["id"])
    if not settings.codex_cli_enabled:
        return {"mode": "cli", "ok": False, "message": "DAP_CODEX_CLI_ENABLED=false，未执行本地 Codex CLI，仅生成 handoff 文件。", "handoff_file": str(handoff)}
    workspace = task.get("workspace") or {}
    cwd = Path(workspace.get("repo_path") or settings.codex_workspace_root)
    prompt = f"Read the task handoff file at {handoff}. Execute the task in this repository. Keep changes inside allowed paths and run the configured tests if possible."
    cmd = [settings.codex_cli_command, "exec", "--cd", str(cwd), "--sandbox", settings.codex_cli_sandbox, "--ask-for-approval", settings.codex_cli_approval_policy]
    if settings.codex_cli_profile:
        cmd.extend(["--profile", settings.codex_cli_profile])
    if settings.codex_cli_model:
        cmd.extend(["--model", settings.codex_cli_model])
    cmd.append(prompt)
    try:
        proc = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True, timeout=1800, check=False)
        content = textwrap.shorten((proc.stdout or "") + "\n" + (proc.stderr or ""), width=40000, placeholder="\n...truncated...")
        log_path = settings.codex_task_dir / f"{task['id']}.cli.log"
        log_path.write_text(content, encoding="utf-8")
        db.insert("codex_artifacts", {"id": db.new_id("cxa"), "task_id": task["id"], "artifact_type": "cli_output", "path": str(log_path), "content": content[:8000], "created_at": db.now()})
        return {"mode": "cli", "ok": proc.returncode == 0, "returncode": proc.returncode, "message": "Codex CLI 执行完成" if proc.returncode == 0 else "Codex CLI 执行失败", "command": " ".join(cmd[:-1] + ["<handoff prompt>"]), "log_path": str(log_path), "output_preview": content[:3000]}
    except Exception as exc:
        return {"mode": "cli", "ok": False, "message": f"Codex CLI 执行异常：{exc}", "handoff_file": str(handoff)}


def _dispatch_sdk(task: dict[str, Any]) -> dict[str, Any]:
    handoff = write_handoff_artifact(task["id"])
    if not settings.codex_sdk_enabled:
        return {"mode": "sdk", "ok": False, "message": "DAP_CODEX_SDK_ENABLED=false，未执行 Codex SDK，仅生成 handoff 文件。", "handoff_file": str(handoff)}
    if importlib.util.find_spec(settings.codex_sdk_python_module) is None:
        return {"mode": "sdk", "ok": False, "message": f"未找到 Python 模块 {settings.codex_sdk_python_module}。请从 openai/codex 仓库的 sdk/python 安装后再启用。", "handoff_file": str(handoff)}
    try:
        module = __import__(settings.codex_sdk_python_module, fromlist=["Codex"])
        Codex = getattr(module, "Codex")
        AppServerConfig = getattr(module, "AppServerConfig", None)
        workspace = task.get("workspace") or {}
        cwd = Path(workspace.get("repo_path") or settings.codex_workspace_root)
        prompt = f"Read the task handoff file at {handoff} and execute it in repository {cwd}."
        # Keep constructor compatibility with current and earlier experimental SDKs.
        if AppServerConfig:
            try:
                config = AppServerConfig(codex_bin=settings.codex_cli_command)
                codex_ctx = Codex(config)
            except TypeError:
                codex_ctx = Codex()
        else:
            codex_ctx = Codex()
        with codex_ctx as codex:
            try:
                thread = codex.thread_start(model=settings.codex_sdk_model)
            except TypeError:
                thread = codex.thread_start()
            result = thread.run(prompt)
            final = getattr(result, "final_response", None) or str(result)
            thread_id = getattr(thread, "id", "") or getattr(result, "thread_id", "")
        content = textwrap.shorten(final, width=40000, placeholder="\n...truncated...")
        log_path = settings.codex_task_dir / f"{task['id']}.sdk.log"
        log_path.write_text(content, encoding="utf-8")
        db.insert("codex_artifacts", {"id": db.new_id("cxa"), "task_id": task["id"], "artifact_type": "sdk_output", "path": str(log_path), "content": content[:8000], "created_at": db.now()})
        return {"mode": "sdk", "ok": True, "message": "Codex SDK 执行完成", "thread_id": thread_id, "log_path": str(log_path), "output_preview": content[:3000]}
    except Exception as exc:
        return {"mode": "sdk", "ok": False, "message": f"Codex SDK 执行异常：{exc}", "handoff_file": str(handoff)}
