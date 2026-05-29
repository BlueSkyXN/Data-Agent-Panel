if (Get-Command codex -ErrorAction SilentlyContinue) {
  codex --version
  exit 0
}
if (Get-Command npm -ErrorAction SilentlyContinue) {
  npm install -g @openai/codex
} else {
  powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
}
codex --version
