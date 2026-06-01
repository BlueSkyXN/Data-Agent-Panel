from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _truthy(value: str | None) -> bool:
    return (value or "").lower() in {"1", "true", "yes", "on"}


def _env(name: str, default: str = "") -> str:
    """Read standalone platform environment variables with the DAP_ prefix."""
    return os.getenv(f"DAP_{name}", default)


def _is_hf_space() -> bool:
    return _truthy(_env("HF_SPACE")) or bool(os.getenv("SPACE_ID") or os.getenv("SPACE_HOST"))


def _path_is_relative_to(path: Path, base: Path) -> bool:
    try:
        path.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False


def _default_data_dir() -> Path:
    explicit = _env("DATA_DIR")
    if explicit:
        return Path(explicit)
    persist_dir = _env("PERSIST_DIR")
    candidates: list[Path] = []
    if persist_dir:
        candidates.append(Path(persist_dir) / "data-agent-platform")
    if _is_hf_space():
        candidates.extend([Path("/persist/data-agent-platform"), Path("/data/data-agent-platform"), Path("/tmp/data-agent-platform")])
    candidates.append(ROOT / "data")
    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
            probe = candidate / ".write_test"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
            return candidate
        except Exception:
            continue
    return ROOT / "data"


class Settings:
    app_name: str = _env("APP_NAME", "独立数据智能体平台")
    app_version: str = _env("APP_VERSION", "0.6.0-standalone")
    app_env: str = _env("APP_ENV", "dev")
    demo_mode: bool = _truthy(_env("DEMO_MODE", "true"))
    secret_key: str = _env("SECRET_KEY", "change-me-in-production")
    token_ttl_minutes: int = int(_env("TOKEN_TTL_MINUTES", "480"))
    cors_origins: list[str] = [x.strip() for x in _env("CORS_ORIGINS", "*").split(",") if x.strip()]
    hf_space: bool = _is_hf_space()
    space_host: str = os.getenv("SPACE_HOST", "")
    space_id: str = os.getenv("SPACE_ID", "")
    ops_token: str = _env("OPS_TOKEN", "")
    data_dir: Path = _default_data_dir()
    db_path: Path = Path(_env("DB_PATH", str(data_dir / "data_agent_platform.db")))
    business_db_path: Path = Path(_env("BUSINESS_DB_PATH", str(data_dir / "business_sample.db")))
    request_timeout_ms: int = int(_env("REQUEST_TIMEOUT_MS", "120000"))
    sql_max_rows: int = int(_env("SQL_MAX_ROWS", "500"))
    sql_timeout_ms: int = int(_env("SQL_TIMEOUT_MS", "5000"))
    chat_rate_limit_per_minute: int = int(_env("CHAT_RATE_LIMIT_PER_MINUTE", "60"))
    auth_rate_limit_per_minute: int = int(_env("AUTH_RATE_LIMIT_PER_MINUTE", "20"))
    sqlite_busy_timeout_ms: int = int(_env("SQLITE_BUSY_TIMEOUT_MS", "5000"))
    sqlite_journal_mode: str = _env("SQLITE_JOURNAL_MODE", "WAL")
    sqlite_synchronous: str = _env("SQLITE_SYNCHRONOUS", "NORMAL")
    sqlite_backup_max_age_hours: int = int(_env("SQLITE_BACKUP_MAX_AGE_HOURS", "168"))
    sqlite_min_free_mb: int = int(_env("SQLITE_MIN_FREE_MB", "256"))
    sqlite_init_lock_timeout_seconds: int = int(_env("SQLITE_INIT_LOCK_TIMEOUT_SECONDS", "30"))
    max_login_failures: int = int(_env("MAX_LOGIN_FAILURES", "5"))
    lockout_minutes: int = int(_env("LOCKOUT_MINUTES", "15"))
    allow_demo_seed: bool = _truthy(_env("ALLOW_DEMO_SEED", "true"))
    bootstrap_admin_username: str = _env("BOOTSTRAP_ADMIN_USERNAME", "")
    bootstrap_admin_password: str = _env("BOOTSTRAP_ADMIN_PASSWORD", "")
    bootstrap_admin_name: str = _env("BOOTSTRAP_ADMIN_NAME", "Bootstrap Admin")
    bootstrap_admin_email: str = _env("BOOTSTRAP_ADMIN_EMAIL", "")
    bootstrap_admin_department: str = _env("BOOTSTRAP_ADMIN_DEPARTMENT", "Platform")
    log_level: str = _env("LOG_LEVEL", "INFO")
    allowed_external_agent_hosts: list[str] = [x.strip() for x in _env("ALLOWED_EXTERNAL_AGENT_HOSTS", "localhost,127.0.0.1").split(",") if x.strip()]
    codex_mode: str = _env("CODEX_MODE", "mock")  # mock | http | cli | sdk
    codex_endpoint: str = _env("CODEX_ENDPOINT", "")
    codex_cli_enabled: bool = _truthy(_env("CODEX_CLI_ENABLED", "false"))
    codex_cli_command: str = _env("CODEX_CLI_COMMAND", "codex")
    codex_cli_sandbox: str = _env("CODEX_CLI_SANDBOX", "workspace-write")
    codex_cli_approval_policy: str = _env("CODEX_CLI_APPROVAL_POLICY", "never")
    codex_cli_approval: str = codex_cli_approval_policy
    codex_cli_json: bool = _truthy(_env("CODEX_CLI_JSON", "false"))
    codex_cli_timeout_seconds: int = int(_env("CODEX_CLI_TIMEOUT_SECONDS", "1800"))
    codex_cli_profile: str = _env("CODEX_CLI_PROFILE", "")
    codex_cli_model: str = _env("CODEX_CLI_MODEL", "")
    codex_sdk_enabled: bool = _truthy(_env("CODEX_SDK_ENABLED", "false"))
    codex_sdk_model: str = _env("CODEX_SDK_MODEL", "gpt-5.4")
    codex_sdk_python_module: str = _env("CODEX_SDK_PYTHON_MODULE", "codex_app_server")
    codex_sdk_repo_raw: str = _env("CODEX_SDK_REPO", "")
    codex_sdk_repo: Path | None = Path(codex_sdk_repo_raw) if codex_sdk_repo_raw else None
    codex_workspace_root: Path = Path(_env("CODEX_WORKSPACE_ROOT", str(ROOT)))
    codex_task_dir: Path = Path(_env("CODEX_TASK_DIR", str(data_dir / "codex_tasks")))
    codex_max_prompt_chars: int = int(_env("CODEX_MAX_PROMPT_CHARS", "12000"))
    codex_require_approval_default: bool = _truthy(_env("CODEX_REQUIRE_APPROVAL", "true"))

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"prod", "production"}

    @property
    def cors_allow_credentials(self) -> bool:
        return "*" not in self.cors_origins

    def validate_for_runtime(self) -> list[str]:
        warnings: list[str] = []
        hardened_runtime = self.is_production or self.hf_space
        if hardened_runtime and self.secret_key == "change-me-in-production":
            warnings.append("DAP_SECRET_KEY is using the default value; set a strong secret before production use.")
        if hardened_runtime and not self.ops_token:
            warnings.append("DAP_OPS_TOKEN is empty; /_ops endpoints are locked until a token is configured.")
        if hardened_runtime and "*" in self.cors_origins:
            warnings.append("DAP_CORS_ORIGINS allows '*'; restrict origins before production use.")
        if hardened_runtime and self.demo_mode and self.allow_demo_seed:
            warnings.append("DAP demo seed is enabled in a hardened runtime; default demo users and fixtures may be created on first startup.")
        bootstrap_admin_configured = bool(self.bootstrap_admin_password)
        if hardened_runtime and (not self.demo_mode or not self.allow_demo_seed) and not bootstrap_admin_configured:
            warnings.append("DAP demo seed is disabled; provision administrator accounts before first login.")
        if hardened_runtime and bootstrap_admin_configured:
            warnings.append("DAP_BOOTSTRAP_ADMIN_PASSWORD is configured; remove it after the initial administrator has been created.")
        if self.is_production and self.demo_mode:
            warnings.append("DAP_DEMO_MODE=true in production; disable demo mode after initial validation.")
        if self.is_production and self.codex_mode == "cli" and not self.codex_cli_enabled:
            warnings.append("DAP_CODEX_MODE=cli but DAP_CODEX_CLI_ENABLED=false; Codex tasks will only be prepared, not dispatched.")
        if self.is_production and self.codex_mode == "http" and not self.codex_endpoint:
            warnings.append("DAP_CODEX_MODE=http but DAP_CODEX_ENDPOINT is empty; Codex adapter will run as prepared handoff only.")
        if self.is_production and self.codex_mode == "sdk" and not self.codex_sdk_enabled:
            warnings.append("DAP_CODEX_MODE=sdk but DAP_CODEX_SDK_ENABLED=false; Codex tasks will only be prepared, not executed via SDK.")
        if hardened_runtime and _path_is_relative_to(self.data_dir, ROOT):
            warnings.append("SQLite data dir is inside the repository; set DAP_DATA_DIR or DAP_PERSIST_DIR to a writable persistent runtime path.")
        if hardened_runtime and _path_is_relative_to(self.data_dir, Path("/tmp")):
            warnings.append("SQLite data dir is under /tmp and may be ephemeral; set DAP_DATA_DIR or DAP_PERSIST_DIR for durable runtime data.")
        if hardened_runtime:
            for env_name, path in [("DAP_DB_PATH", self.db_path), ("DAP_BUSINESS_DB_PATH", self.business_db_path)]:
                if not _path_is_relative_to(path, self.data_dir):
                    warnings.append(f"{env_name} is outside DAP_DATA_DIR; keep SQLite DB files under DAP_DATA_DIR or DAP_PERSIST_DIR so backup, locks, and storage checks cover runtime data.")
                if _path_is_relative_to(path, ROOT):
                    warnings.append(f"{env_name} points inside the repository; set it under DAP_DATA_DIR or DAP_PERSIST_DIR for durable SQLite data.")
                if _path_is_relative_to(path, Path("/tmp")):
                    warnings.append(f"{env_name} points under /tmp and may be ephemeral; set it under DAP_DATA_DIR or DAP_PERSIST_DIR for durable SQLite data.")
        return warnings

    def redacted(self) -> dict:
        return {
            "app_name": self.app_name,
            "app_version": self.app_version,
            "app_env": self.app_env,
            "hf_space": self.hf_space,
            "space_host": self.space_host,
            "space_id": self.space_id,
            "demo_mode": self.demo_mode,
            "cors_origins": self.cors_origins,
            "data_dir": str(self.data_dir),
            "db_path": str(self.db_path),
            "business_db_path": str(self.business_db_path),
            "sql_max_rows": self.sql_max_rows,
            "sql_timeout_ms": self.sql_timeout_ms,
            "chat_rate_limit_per_minute": self.chat_rate_limit_per_minute,
            "allowed_external_agent_hosts": self.allowed_external_agent_hosts,
            "sqlite_busy_timeout_ms": self.sqlite_busy_timeout_ms,
            "sqlite_journal_mode": self.sqlite_journal_mode,
            "sqlite_synchronous": self.sqlite_synchronous,
            "sqlite_backup_max_age_hours": self.sqlite_backup_max_age_hours,
            "sqlite_min_free_mb": self.sqlite_min_free_mb,
            "sqlite_init_lock_timeout_seconds": self.sqlite_init_lock_timeout_seconds,
            "bootstrap_admin_configured": bool(self.bootstrap_admin_password),
            "codex_mode": self.codex_mode,
            "codex_cli_enabled": self.codex_cli_enabled,
            "codex_cli_sandbox": self.codex_cli_sandbox,
            "codex_cli_approval_policy": self.codex_cli_approval_policy,
            "codex_cli_json": self.codex_cli_json,
            "codex_cli_timeout_seconds": self.codex_cli_timeout_seconds,
            "codex_cli_profile": self.codex_cli_profile,
            "codex_cli_model": self.codex_cli_model,
            "codex_sdk_enabled": self.codex_sdk_enabled,
            "codex_sdk_model": self.codex_sdk_model,
            "codex_sdk_python_module": self.codex_sdk_python_module,
            "codex_sdk_repo_configured": bool(self.codex_sdk_repo_raw),
            "codex_workspace_root": str(self.codex_workspace_root),
            "codex_task_dir": str(self.codex_task_dir),
            "codex_require_approval_default": self.codex_require_approval_default,
            "runtime_warnings": self.validate_for_runtime(),
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
