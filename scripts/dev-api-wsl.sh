#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
uv_executable="$workspace_root/.tools/wsl/bin/uv"

if [[ ! -x "$uv_executable" ]]; then
  echo "WSL uv is missing at $uv_executable" >&2
  echo "Run the WSL backend setup before starting the development server." >&2
  exit 1
fi

export UV_CACHE_DIR="$workspace_root/.cache/uv-wsl"
export UV_PYTHON_INSTALL_DIR="$workspace_root/.tools/python-wsl"
export UV_PROJECT_ENVIRONMENT="$workspace_root/.tools/wsl/venv/backend"

exec "$uv_executable" run \
  --project "$workspace_root/backend" \
  uvicorn app.main:app \
  --app-dir "$workspace_root/backend" \
  --reload \
  --reload-dir "$workspace_root/backend/app" \
  --host 0.0.0.0 \
  --port 8000
