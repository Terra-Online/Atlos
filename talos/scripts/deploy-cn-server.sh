#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SSH_HOST="${ATLOS_CN_SSH_HOST:-atlos-cn}"
REMOTE_DIR="${ATLOS_CN_REMOTE_DIR:-workspace/atlos-assets/_WORK_DIR/Atlos/talos}"
SKIP_BUILD="${ATLOS_CN_SKIP_BUILD:-0}"
DIST_DIR="${DIST_DIR:-dist/oss}"
SERVER_ONLY=0
CHANNEL="${DEPLOY_CHANNEL:-prod}"

usage() {
    cat <<'EOF'
Usage: deploy-cn-server.sh [options]

Build the CN frontend, publish it to OSS, and replace the server dist/.

Options:
  --skip-build          Publish the existing local dist without rebuilding
  --server-only         Replace server dist only; skip OSS publishing
  --channel prod        Server accepts production artifacts only
  --dist-dir PATH       Local build directory (default: dist/oss)
  --host HOST           SSH host or ~/.ssh/config alias (default: atlos-cn)
  --remote-dir PATH     Remote talos directory
  -h, --help            Show this help

Environment overrides:
  ATLOS_CN_SSH_HOST
  ATLOS_CN_REMOTE_DIR
  ATLOS_CN_SKIP_BUILD=1
  DIST_DIR
EOF
}

while (($# > 0)); do
    case "$1" in
        --server-only)
            SERVER_ONLY=1
            shift
            ;;
        --channel)
            [[ $# -ge 2 ]] || { echo "Missing value for --channel" >&2; exit 2; }
            CHANNEL="$2"
            shift 2
            ;;
        --channel=*)
            CHANNEL="${1#*=}"
            shift
            ;;
        --skip-build)
            SKIP_BUILD=1
            shift
            ;;
        --host)
            [[ $# -ge 2 ]] || { echo "Missing value for --host" >&2; exit 2; }
            SSH_HOST="$2"
            shift 2
            ;;
        --dist-dir)
            [[ $# -ge 2 ]] || { echo "Missing value for --dist-dir" >&2; exit 2; }
            DIST_DIR="$2"
            shift 2
            ;;
        --dist-dir=*)
            DIST_DIR="${1#*=}"
            shift
            ;;
        --host=*)
            SSH_HOST="${1#*=}"
            shift
            ;;
        --remote-dir)
            [[ $# -ge 2 ]] || { echo "Missing value for --remote-dir" >&2; exit 2; }
            REMOTE_DIR="$2"
            shift 2
            ;;
        --remote-dir=*)
            REMOTE_DIR="${1#*=}"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

if [[ "$CHANNEL" != "prod" ]]; then
    echo "The CN server serves prod only; refusing channel: $CHANNEL" >&2
    exit 2
fi
export DEPLOY_CHANNEL="$CHANNEL"

commands=(zip unzip scp ssh)
if [[ "$SKIP_BUILD" != "1" || "$SERVER_ONLY" != "1" ]]; then
    commands+=(node)
fi
if [[ "$SKIP_BUILD" != "1" ]]; then
    commands+=(pnpm)
fi
for command in "${commands[@]}"; do
    command -v "$command" >/dev/null 2>&1 || {
        echo "Required command not found: $command" >&2
        exit 1
    }
done

if [[ "$REMOTE_DIR" =~ [[:space:]] ]]; then
    echo "Remote directory must not contain whitespace: $REMOTE_DIR" >&2
    exit 2
fi

cd "$ROOT"

if [[ "$SKIP_BUILD" != "1" ]]; then
    echo "==> Building CN frontend"
    node scripts/tasks.mjs build --target cn --channel "$CHANNEL" --dist-dir "$DIST_DIR"
else
    echo "==> Skipping build; using existing dist/"
fi

if [[ "$DIST_DIR" != /* ]]; then
    DIST_DIR="${ROOT}/${DIST_DIR}"
fi

if [[ ! -f "${DIST_DIR}/index.html" ]]; then
    echo "${DIST_DIR}/index.html not found; CN build is missing or incomplete." >&2
    exit 1
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/atlos-cn-deploy.XXXXXX")"
ARCHIVE_PATH="${TEMP_DIR}/dist.zip"
ARCHIVE_ENTRIES_PATH="${TEMP_DIR}/dist-entries.txt"
trap 'rm -rf "$TEMP_DIR"' EXIT

echo "==> Packaging ${DIST_DIR} as dist.zip"
(
    cd "$DIST_DIR"
    zip -qr "$ARCHIVE_PATH" .
)

unzip -Z1 "$ARCHIVE_PATH" > "$ARCHIVE_ENTRIES_PATH"

if ! grep -Fxq 'index.html' "$ARCHIVE_ENTRIES_PATH"; then
    echo "dist.zip does not contain index.html at its root." >&2
    exit 1
fi
if grep -Eq '^(oss|dist/oss)/' "$ARCHIVE_ENTRIES_PATH"; then
    echo "dist.zip unexpectedly contains an oss directory layer." >&2
    exit 1
fi

deploy_server_dist() {
    echo "==> Uploading to ${SSH_HOST}:${REMOTE_DIR}/dist.zip.uploading"
    scp "$ARCHIVE_PATH" "${SSH_HOST}:${REMOTE_DIR}/dist.zip.uploading"

    echo "==> Replacing remote dist/"
    ssh "$SSH_HOST" bash -s -- "$REMOTE_DIR" <<'REMOTE_SCRIPT'
set -euo pipefail

remote_dir="$1"
cd "$remote_dir"

mv -f dist.zip.uploading dist.zip
rm -rf .dist-next
mkdir -p .dist-next/dist
unzip -q -o dist.zip -d .dist-next/dist

if [[ ! -f .dist-next/dist/index.html ]]; then
    echo "Uploaded archive does not contain dist/index.html" >&2
    rm -rf .dist-next
    exit 1
fi

rm -rf dist.previous
if [[ -d dist ]]; then
    mv dist dist.previous
fi

if mv .dist-next/dist dist; then
    rm -rf dist.previous .dist-next dist.zip
else
    if [[ -d dist.previous ]]; then
        mv dist.previous dist
    fi
    rm -rf .dist-next
    exit 1
fi
REMOTE_SCRIPT

    echo "==> Server dist deployed to ${SSH_HOST}:${REMOTE_DIR}/dist"
}

if [[ "$SERVER_ONLY" == "1" ]]; then
    deploy_server_dist
    echo "==> CN server dist deployment succeeded"
    exit 0
fi

echo "==> Publishing CN dist to OSS while deploying the server dist"
DIST_DIR="$DIST_DIR" node scripts/publish-oss.js &
PUBLISH_PID=$!

SERVER_STATUS=0
deploy_server_dist || SERVER_STATUS=$?

PUBLISH_STATUS=0
wait "$PUBLISH_PID" || PUBLISH_STATUS=$?

if ((PUBLISH_STATUS != 0 || SERVER_STATUS != 0)); then
    if ((PUBLISH_STATUS != 0)); then
        echo "OSS publish failed with exit code $PUBLISH_STATUS" >&2
    fi
    if ((SERVER_STATUS != 0)); then
        echo "Server dist deployment failed with exit code $SERVER_STATUS" >&2
    fi
    exit 1
fi

echo "==> CN release complete: OSS publish and server dist deployment succeeded"
