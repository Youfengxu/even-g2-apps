#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/pack-app.sh <app-name> [--skip-build]

Builds and packs a standalone app from apps/<app-name> using evenhub-cli.

Examples:
  ./scripts/pack-app.sh timer
  ./scripts/pack-app.sh quicktest --skip-build
EOF
}

is_standalone_app_dir() {
  local dir="$1"
  [ -d "${dir}" ] || return 1
  [ -f "${dir}/app.json" ] || return 1
  [ -f "${dir}/index.html" ] || return 1
  [ -d "${dir}/src" ] || return 1
  [ -f "${dir}/src/main.ts" ] || [ -f "${dir}/src/main.tsx" ] || [ -f "${dir}/src/main.js" ] || [ -f "${dir}/src/main.jsx" ]
}

ensure_app_dependencies() {
  local dir="$1"

  if [ ! -d "${dir}/node_modules" ]; then
    echo "Installing app dependencies..."
    npm --prefix "${dir}" install
    return
  fi

  if ! npm --prefix "${dir}" ls --depth=0 >/dev/null 2>&1; then
    echo "Refreshing app dependencies (existing node_modules is stale or incomplete)..."
    npm --prefix "${dir}" install
  fi
}

APP_NAME=""
SKIP_BUILD=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --skip-build)
      SKIP_BUILD=1
      ;;
    --*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [ -n "${APP_NAME}" ]; then
        echo "Unexpected extra argument: $1" >&2
        usage >&2
        exit 1
      fi
      APP_NAME="$1"
      ;;
  esac
  shift
done

if [ -z "${APP_NAME}" ]; then
  usage >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/apps/${APP_NAME}"

if ! is_standalone_app_dir "${APP_DIR}"; then
  echo "App '${APP_NAME}' is not a standalone app (expected app.json, index.html, and src/main.* in ${APP_DIR})." >&2
  exit 1
fi

if [ ! -f "${APP_DIR}/package.json" ]; then
  echo "Missing ${APP_DIR}/package.json" >&2
  exit 1
fi

ensure_app_dependencies "${APP_DIR}"

if [ "${SKIP_BUILD}" -ne 1 ]; then
  echo "Building ${APP_NAME}..."
  npm --prefix "${APP_DIR}" run build
fi

if [ ! -d "${APP_DIR}/dist" ] || [ ! -f "${APP_DIR}/dist/index.html" ]; then
  echo "Missing build output in ${APP_DIR}/dist (run build first or omit --skip-build)." >&2
  exit 1
fi

echo "Packing ${APP_NAME}..."
(
  cd "${APP_DIR}"
  npx @evenrealities/evenhub-cli pack app.json dist
)

if [ -f "${APP_DIR}/out.ehpk" ]; then
  echo "Created package: ${APP_DIR}/out.ehpk"
fi
