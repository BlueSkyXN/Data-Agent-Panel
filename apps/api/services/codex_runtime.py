from __future__ import annotations

import json
import os
import shutil
import subprocess
import textwrap
import time
from pathlib import Path
from typing import Any

from ..config import get_settings

settings = get_settings()


def _shorten(value: str, width: int = 30000) -> str:
    return textwrap.shorten(value or "", width=width, placeholder="\n...truncated...")


def _run_probe(cmd: list[str], timeout: int = 10, input_text: str | None = None) -> dict[str, Any]:
    try:
        proc = subprocess.run(cmd, input=input_text, capture_output=True, text=True, timeout=timeout, check=False)
        return {
            "command": cmd,
            "returncode": proc.returncode,
            "stdout": _shorten(proc.stdout, 4000),
            "stderr": _shorten(proc.stderr, 4000),
            "ok": proc.returncode == 0,
        }
    except Exception as exc:
        return {"command": cmd, "returncode": None, "stdout": "", "stderr": str(exc), "ok": False}


def install_instructions() -> dict[str, Any]:
    return {
        "mac_linux_install_script": "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
        "windows_install_script": "powershell -ExecutionPolicy ByPass -c \"irm https://chatgpt.com/codex/install.ps1 | iex\"",
        "npm": "npm install -g @openai/codex",
        "homebrew": "brew install --cask codex",
        "login_chatgpt": "codex login",
        "login_api_key": "printenv OPENAI_API_KEY | codex login --with-api-key",
        "login_status": "codex login status",
        "non_interactive_example": "codex exec --cd <repo> --sandbox workspace-write --ask-for-approval never --output-last-message out.md -",
        "sdk_note": "Codex Python SDK is experimental and requires a local checkout of openai/codex plus editable installation from sdk/python.",
    }


def preflight() -> dict[str, Any]:
    binary = shutil.which(settings.codex_cli_command)
    out: dict[str, Any] = {
        "mode": settings.codex_mode,
        "cli_command": settings.codex_cli_command,
        "cli_enabled": settings.codex_cli_enabled,
        "cli_binary": binary,
        "cli_available": bool(binary),
        "cli_sandbox": settings.codex_cli_sandbox,
        "cli_approval": settings.codex_cli_approval,
        "cli_model": settings.codex_cli_model,
        "sdk_enabled": settings.codex_sdk_enabled,
        "sdk_repo": str(settings.codex_sdk_repo) if settings.codex_sdk_repo else "",
        "sdk_available": False,
        "sdk_reason": "",
        "workspace_root": str(settings.codex_workspace_root),
        "task_dir": str(settings.codex_task_dir),
        "install": install_instructions(),
    }
    if binary:
        out["version_probe"] = _run_probe([settings.codex_cli_command, "--version"], timeout=8)
        out["login_probe"] = _run_probe([settings.codex_cli_command, "login", "status"], timeout=12)
    else:
        out["version_probe"] = {"ok": False, "stderr": "Codex CLI binary not found in PATH."}
        out["login_probe"] = {"ok": False, "stderr": "Skipped because Codex CLI binary is not installed."}
    if settings.codex_sdk_enabled:
        repo = settings.codex_sdk_repo
        if repo and Path(repo).exists():
            sdk_py = Path(repo) / "sdk" / "python"
            out["sdk_available"] = sdk_py.exists()
            out["sdk_reason"] = "SDK python directory found." if sdk_py.exists() else "Local Codex repo found, but sdk/python was not found."
        else:
            out["sdk_reason"] = "DAP_CODEX_SDK_REPO does not point to a local Codex checkout."
    else:
        out["sdk_reason"] = "DAP_CODEX_SDK_ENABLED=false."
    return out


def _workspace(task: dict[str, Any]) -> dict[str, Any]:
    ws = task.get("workspace") or {}
    if isinstance(ws.get("allowed_paths"), str):
        try:
            ws["allowed_paths"] = json.loads(ws["allowed_paths"] or "[]")
        except Exception:
            ws["allowed_paths"] = []
    return ws


def _workspace_path(task: dict[str, Any]) -> Path:
    ws = _workspace(task)
    raw = ws.get("repo_path") or str(settings.codex_workspace_root)
    path = Path(raw).expanduser().resolve()
    root = Path(settings.codex_workspace_root).expanduser().resolve()
    # Allow the configured repo path, but reject obviously unsafe roots in production.
    if settings.is_production and path == Path("/"):
        raise RuntimeError("Refusing to run Codex from filesystem root in production.")
    return path if path.exists() else root


def build_cli_command(task: dict[str, Any], output_file: Path) -> list[str]:
    cwd = _workspace_path(task)
    cmd = [
        settings.codex_cli_command,
        "exec",
        "--cd", str(cwd),
        "--sandbox", settings.codex_cli_sandbox,
        "--ask-for-approval", settings.codex_cli_approval,
        "--skip-git-repo-check",
        "--output-last-message", str(output_file),
    ]
    if settings.codex_cli_json:
        cmd.append("--json")
    if settings.codex_cli_model:
        cmd.extend(["--model", settings.codex_cli_model])
    cmd.append("-")
    return cmd


def run_cli_task(task: dict[str, Any]) -> dict[str, Any]:
    task_id = task["id"]
    task_root = Path(settings.codex_task_dir) / task_id
    task_root.mkdir(parents=True, exist_ok=True)
    prompt_file = task_root / "prompt.md"
    output_file = task_root / "final-message.md"
    stdout_file = task_root / "stdout.log"
    stderr_file = task_root / "stderr.log"
    prompt = task["task_prompt"]
    prompt_file.write_text(prompt, encoding="utf-8")
    if not settings.codex_cli_enabled:
        return {
            "mode": "cli",
            "status": "prepared",
            "message": "DAP_CODEX_CLI_ENABLED=false；已生成 prompt 文件，但未执行 Codex CLI。",
            "prompt_file": str(prompt_file),
            "command_preview": build_cli_command(task, output_file),
        }
    if not shutil.which(settings.codex_cli_command):
        return {
            "mode": "cli",
            "status": "not_installed",
            "message": "未在 PATH 中找到 Codex CLI。请先安装 @openai/codex 并完成登录。",
            "prompt_file": str(prompt_file),
            "install": install_instructions(),
        }
    cmd = build_cli_command(task, output_file)
    started = time.time()
    try:
        proc = subprocess.run(
            cmd,
            input=prompt,
            cwd=str(_workspace_path(task)),
            capture_output=True,
            text=True,
            timeout=settings.codex_cli_timeout_seconds,
            check=False,
        )
        stdout_file.write_text(proc.stdout or "", encoding="utf-8")
        stderr_file.write_text(proc.stderr or "", encoding="utf-8")
        final_message = output_file.read_text(encoding="utf-8") if output_file.exists() else ""
        return {
            "mode": "cli",
            "status": "success" if proc.returncode == 0 else "failed",
            "returncode": proc.returncode,
            "duration_ms": int((time.time() - started) * 1000),
            "command": cmd,
            "prompt_file": str(prompt_file),
            "stdout_file": str(stdout_file),
            "stderr_file": str(stderr_file),
            "output_file": str(output_file),
            "final_message": _shorten(final_message, 20000),
            "stdout_preview": _shorten(proc.stdout or "", 6000),
            "stderr_preview": _shorten(proc.stderr or "", 6000),
            "message": "Codex CLI 执行完成。" if proc.returncode == 0 else "Codex CLI 执行失败，请查看 stdout/stderr。",
        }
    except subprocess.TimeoutExpired as exc:
        stdout_file.write_text(exc.stdout or "", encoding="utf-8")
        stderr_file.write_text((exc.stderr or "") + "\nTIMEOUT", encoding="utf-8")
        return {"mode": "cli", "status": "timeout", "message": "Codex CLI 执行超时。", "command": cmd, "stdout_file": str(stdout_file), "stderr_file": str(stderr_file)}
    except Exception as exc:
        return {"mode": "cli", "status": "error", "message": f"Codex CLI 执行异常：{exc}", "command": cmd, "prompt_file": str(prompt_file)}


def run_sdk_task(task: dict[str, Any]) -> dict[str, Any]:
    task_id = task["id"]
    task_root = Path(settings.codex_task_dir) / task_id
    task_root.mkdir(parents=True, exist_ok=True)
    prompt_file = task_root / "sdk-prompt.md"
    prompt_file.write_text(task["task_prompt"], encoding="utf-8")
    if not settings.codex_sdk_enabled:
        return {"mode": "sdk", "status": "prepared", "message": "DAP_CODEX_SDK_ENABLED=false；SDK 模式仅生成交接文件。", "prompt_file": str(prompt_file)}
    repo = settings.codex_sdk_repo
    if not repo or not Path(repo).exists():
        return {"mode": "sdk", "status": "not_configured", "message": "未配置本地 openai/codex 仓库；Codex SDK 需要本地 checkout 并从 sdk/python 可编辑安装。", "prompt_file": str(prompt_file)}
    # The public SDK is experimental. This bridge intentionally keeps a safe boundary:
    # it validates local repo presence and emits a runnable bootstrap command instead of
    # assuming a stable Python package API.
    helper = Path("scripts/codex_sdk_runner.py").resolve()
    return {
        "mode": "sdk",
        "status": "prepared",
        "message": "已生成 SDK 交接包。安装 Codex SDK 后可用 scripts/codex_sdk_runner.py 对接 app-server JSON-RPC。",
        "prompt_file": str(prompt_file),
        "sdk_repo": str(repo),
        "helper": str(helper),
        "bootstrap": f"cd {repo}/sdk/python && python -m pip install -e .",
    }
