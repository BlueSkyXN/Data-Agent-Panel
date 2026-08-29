#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import io
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock


SCRIPT_PATH = Path(__file__).with_name("hf_space_sync.py")


def install_huggingface_stub_if_needed() -> None:
    try:
        import huggingface_hub  # noqa: F401
    except ModuleNotFoundError:
        hub = types.ModuleType("huggingface_hub")
        utils = types.ModuleType("huggingface_hub.utils")

        class HfApi:
            pass

        def build_hf_headers(*_args: object, **_kwargs: object) -> dict[str, str]:
            return {}

        def validate_repo_id(repo_id: str) -> None:
            if not repo_id:
                raise ValueError("empty repo id")

        hub.HfApi = HfApi
        utils.build_hf_headers = build_hf_headers
        utils.validate_repo_id = validate_repo_id
        sys.modules["huggingface_hub"] = hub
        sys.modules["huggingface_hub.utils"] = utils


install_huggingface_stub_if_needed()
spec = importlib.util.spec_from_file_location("hf_space_sync", SCRIPT_PATH)
assert spec and spec.loader
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def manifest_text(**overrides: object) -> str:
    values: dict[str, object] = {
        "standard": "3.0",
        "project": "demo",
        "space": "example-org/demo",
        "project_class": "preview",
        "target_role": "primary",
        "space_visibility": "protected",
        "bucket_visibility": "private",
        "env_file": ".env",
        "sovereignty": "sovereign",
        "lane": "artifact",
        "version_source": "tag",
        "local_only": ["HF_TOKEN", "GH_TOKEN"],
        "secrets": ["APP_SECRET"],
        "optional_secrets": [],
        "variables": ["APP_MODE"],
        "dist_bucket": "hfs-dist",
        "seed_file": None,
        "other_objects": [],
        "mount_config_bucket": "demo-config",
        "mount_config_object": "config/config.toml",
    }
    values.update(overrides)
    lines: list[str] = []
    for key, value in values.items():
        if value is None:
            continue
        if isinstance(value, str):
            lines.append(f'{key} = "{value}"')
        elif isinstance(value, list):
            rendered = ", ".join(f'"{item}"' for item in value)
            lines.append(f"{key} = [{rendered}]")
        else:
            raise AssertionError((key, value))
    return "\n".join(lines) + "\n"


class FakeApi:
    def __init__(self, secrets: set[str] | None = None) -> None:
        self.secrets = set(secrets or set())
        self.variables: dict[str, types.SimpleNamespace] = {}
        self.write_events: list[tuple[str, str]] = []

    def whoami(self, **_kwargs: object) -> dict[str, str]:
        return {"name": "example-user"}

    def space_info(self, *_args: object, **_kwargs: object) -> object:
        return types.SimpleNamespace(private=True)

    def list_user_repos(self, *_args: object, **_kwargs: object) -> list[types.SimpleNamespace]:
        return [types.SimpleNamespace(id="example-org/demo", type="space", visibility="protected")]

    def bucket_info(self, *_args: object, **_kwargs: object) -> types.SimpleNamespace:
        return types.SimpleNamespace(private=True)

    def update_repo_settings(self, *_args: object, **_kwargs: object) -> None:
        return None

    def add_space_secret(self, _space: str, name: str, _value: str, **_kwargs: object) -> None:
        self.write_events.append(("secret", name))
        self.secrets.add(name)

    def add_space_variable(
        self,
        _space: str,
        name: str,
        value: str,
        **_kwargs: object,
    ) -> None:
        self.write_events.append(("variable", name))
        self.variables[name] = types.SimpleNamespace(value=value)

    def delete_space_secret(self, _space: str, name: str, **_kwargs: object) -> None:
        self.write_events.append(("delete-secret", name))
        self.secrets.discard(name)

    def delete_space_variable(self, _space: str, name: str, **_kwargs: object) -> None:
        self.write_events.append(("delete-variable", name))
        self.variables.pop(name, None)

    def get_space_variables(
        self,
        *_args: object,
        **_kwargs: object,
    ) -> dict[str, types.SimpleNamespace]:
        return dict(self.variables)


class SyncSafetyTests(unittest.TestCase):
    def write_project(
        self,
        root: Path,
        *,
        manifest_overrides: dict[str, object] | None = None,
        env_lines: list[str] | None = None,
        seed: str | None = None,
    ) -> None:
        overrides = dict(manifest_overrides or {})
        if seed is not None:
            overrides.update(seed_file="config.toml", other_objects=["config.toml"])
        (root / "hfs-dev.toml").write_text(
            manifest_text(**overrides),
            encoding="utf-8",
        )
        values = env_lines or [
            "HF_TOKEN=fake-control-value",
            "GH_TOKEN=fake-git-control-value",
            "APP_SECRET=fake-app-secret-value",
            "APP_MODE=preview",
        ]
        env_file = root / ".env"
        env_file.write_text("\n".join(values) + "\n", encoding="utf-8")
        env_file.chmod(0o600)
        if seed is not None:
            (root / "config.toml").write_text(seed, encoding="utf-8")

    def test_push_rejects_variable_credentials_before_any_remote_api_call(self) -> None:
        token_literal = "hf_" + "A" * 20
        cases = [
            "postgresql://app:private-password@db.example/app",
            "https://api.example/v1?client_secret=private-query-value",
            "Server=db.example;AccessToken=private-dsn-value;Database=app",
            token_literal,
        ]
        for value in cases:
            with self.subTest(kind=value.split(":", 1)[0]):
                with tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    self.write_project(
                        root,
                        env_lines=[
                            "HF_TOKEN=fake-control-value",
                            "GH_TOKEN=fake-git-control-value",
                            "APP_SECRET=fake-app-secret-value",
                            f"APP_MODE={value}",
                        ],
                    )
                    with (
                        mock.patch.object(
                            sync,
                            "api_client",
                            side_effect=AssertionError("remote API must not be called"),
                        ) as api_client,
                        mock.patch.object(sync, "bucket_cp") as bucket_copy,
                        self.assertRaises(sync.SyncError) as caught,
                    ):
                        sync.cmd_push(root, prune=False, yes=False)
                    api_client.assert_not_called()
                    bucket_copy.assert_not_called()
                    message = str(caught.exception)
                    self.assertIn("APP_MODE", message)
                    self.assertNotIn(value, message)

    def test_variables_reject_secret_optional_and_local_only_aliases(self) -> None:
        cases = [
            ({}, ["APP_SECRET=protected-app-value"], "protected-app-value", "APP_SECRET"),
            (
                {"optional_secrets": ["OPTIONAL_SECRET"]},
                ["APP_SECRET=fake-app-secret-value", "OPTIONAL_SECRET=protected-optional-value"],
                "prefix-protected-optional-value-suffix",
                "OPTIONAL_SECRET",
            ),
            (
                {"local_only": ["HF_TOKEN", "GH_TOKEN", "PROJECT_CONTROL"]},
                ["APP_SECRET=fake-app-secret-value", "PROJECT_CONTROL=protected-control-value"],
                "prefix-protected-control-value-suffix",
                "PROJECT_CONTROL",
            ),
        ]
        for overrides, extra_env, variable_value, protected_name in cases:
            with self.subTest(protected_name=protected_name):
                with tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    self.write_project(
                        root,
                        manifest_overrides=overrides,
                        env_lines=[
                            "HF_TOKEN=fake-control-value",
                            "GH_TOKEN=fake-git-control-value",
                            *extra_env,
                            f"APP_MODE={variable_value}",
                        ],
                    )
                    with self.assertRaises(sync.SyncError) as caught:
                        sync.preflight(root, for_push=True)
                    message = str(caught.exception)
                    self.assertIn("APP_MODE", message)
                    self.assertIn(protected_name, message)
                    self.assertNotIn(variable_value, message)

    def test_custom_local_only_value_is_protected_in_seed_and_renamed_secret(self) -> None:
        local_value = "protected-control-value"
        overrides = {"local_only": ["HF_TOKEN", "GH_TOKEN", "PROJECT_CONTROL"]}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.write_project(
                root,
                manifest_overrides=overrides,
                env_lines=[
                    "HF_TOKEN=fake-control-value",
                    "GH_TOKEN=fake-git-control-value",
                    "APP_SECRET=fake-app-secret-value",
                    f"PROJECT_CONTROL={local_value}",
                    "APP_MODE=preview",
                ],
                seed=f'service_value = "{local_value}"\n',
            )
            with self.assertRaises(sync.SyncError) as caught:
                sync.preflight(root, for_push=True)
            message = str(caught.exception)
            self.assertIn("local-only:PROJECT_CONTROL", message)
            self.assertNotIn(local_value, message)

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.write_project(
                root,
                manifest_overrides={
                    **overrides,
                    "secrets": ["APP_SECRET", "CONTROL_ALIAS"],
                },
                env_lines=[
                    "HF_TOKEN=fake-control-value",
                    "GH_TOKEN=fake-git-control-value",
                    "APP_SECRET=fake-app-secret-value",
                    f"PROJECT_CONTROL={local_value}",
                    f"CONTROL_ALIAS={local_value}",
                    "APP_MODE=preview",
                ],
            )
            with self.assertRaises(sync.SyncError) as caught:
                sync.preflight(root, for_push=True)
            message = str(caught.exception)
            self.assertIn("CONTROL_ALIAS", message)
            self.assertIn("PROJECT_CONTROL", message)
            self.assertNotIn(local_value, message)

    def test_variable_scan_allows_public_urls_and_placeholders(self) -> None:
        values = [
            "https://api.example/v1?format=json&mode=public",
            "postgresql://readonly@db.example/app?sslmode=require",
            "https://api.example/v1?api_key=%3CSECRET%3E",
        ]
        for value in values:
            with self.subTest(value=value):
                with tempfile.TemporaryDirectory() as temp:
                    root = Path(temp)
                    self.write_project(
                        root,
                        env_lines=[
                            "HF_TOKEN=fake-control-value",
                            "GH_TOKEN=fake-git-control-value",
                            "APP_SECRET=fake-app-secret-value",
                            f"APP_MODE={value}",
                        ],
                    )
                    sync.preflight(root, for_push=True)

    def test_optional_secret_push_and_remote_only_secret_guard_use_local_plaintext(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.write_project(
                root,
                manifest_overrides={"optional_secrets": ["OPTIONAL_SECRET"]},
                env_lines=[
                    "HF_TOKEN=fake-control-value",
                    "GH_TOKEN=fake-git-control-value",
                    "APP_SECRET=fake-app-secret-value",
                    "OPTIONAL_SECRET=fake-optional-secret-value",
                    "APP_MODE=preview",
                ],
            )
            fake_api = FakeApi()
            with (
                mock.patch.object(sync, "api_client", return_value=fake_api),
                mock.patch.object(
                    sync,
                    "space_secret_names",
                    side_effect=lambda *_args: set(fake_api.secrets),
                ),
                redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(sync.cmd_push(root, prune=False, yes=False), 0)
            self.assertIn(("secret", "OPTIONAL_SECRET"), fake_api.write_events)

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.write_project(root)
            fake_api = FakeApi({"REMOTE_ONLY_SECRET"})
            with (
                mock.patch.object(sync, "api_client", return_value=fake_api),
                mock.patch.object(
                    sync,
                    "space_secret_names",
                    side_effect=lambda *_args: set(fake_api.secrets),
                ),
                redirect_stdout(io.StringIO()),
                self.assertRaises(sync.SyncError) as caught,
            ):
                sync.cmd_push(root, prune=False, yes=False)
            self.assertEqual(fake_api.write_events, [])
            self.assertIn("REMOTE_ONLY_SECRET", str(caught.exception))

    def test_pull_rejects_symlink_and_non_directory_components_before_copy(self) -> None:
        for kind in ("symlink", "file"):
            for component in ("local", "hfs-sync-pulled", "demo"):
                with self.subTest(kind=kind, component=component):
                    with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as outside:
                        root = Path(temp)
                        self.write_project(root)
                        parent = root
                        for name in ("local", "hfs-sync-pulled", "demo"):
                            path = parent / name
                            if name == component:
                                if kind == "symlink":
                                    path.symlink_to(Path(outside), target_is_directory=True)
                                else:
                                    path.write_text("not a directory\n", encoding="utf-8")
                                break
                            path.mkdir(mode=0o700)
                            parent = path

                        with (
                            mock.patch.object(sync, "api_client", return_value=FakeApi()),
                            mock.patch.object(sync, "bucket_read_bytes") as bucket_read,
                            redirect_stdout(io.StringIO()),
                            self.assertRaisesRegex(sync.SyncError, "符号链接|目录"),
                        ):
                            sync.cmd_pull(root)
                        bucket_read.assert_not_called()

    def test_unique_pull_dir_rejects_final_parent_symlink_and_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as outside:
            root = Path(temp)
            base = root / "local" / "hfs-sync-pulled" / "demo"
            base.mkdir(parents=True, mode=0o700)
            (base / "20260730010101").symlink_to(
                Path(outside),
                target_is_directory=True,
            )
            with (
                mock.patch.object(sync.time, "strftime", return_value="20260730010101"),
                self.assertRaisesRegex(sync.SyncError, "符号链接"),
            ):
                sync.unique_pull_dir(root, "example-org/demo")

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            with self.assertRaisesRegex(sync.SyncError, "安全的单段名称|项目根"):
                sync.unique_pull_dir(root, "example-org/../../outside")
            self.assertFalse((root / "outside").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
