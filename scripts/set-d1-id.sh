#!/usr/bin/env bash
# Inject the real D1 database id into wrangler.toml from a local, gitignored file.
#
# wrangler.toml is committed with a placeholder database_id so the production
# resource id stays out of version control. Run this once after cloning, and
# again whenever .dev.vars changes the id.
#
#   bash scripts/set-d1-id.sh
#
# The id is read from D1_DATABASE_ID in .dev.vars (already gitignored).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .dev.vars ]]; then
  echo "error: .dev.vars not found (expected to contain D1_DATABASE_ID=...)" >&2
  exit 1
fi

ID="$(grep -E '^D1_DATABASE_ID=' .dev.vars | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"

if [[ -z "$ID" ]]; then
  echo "error: D1_DATABASE_ID is empty or missing in .dev.vars" >&2
  exit 1
fi

CURRENT="$(grep -E '^database_id' wrangler.toml | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"

if [[ "$CURRENT" == "$ID" ]]; then
  echo "database_id already up to date"
  exit 0
fi

# Portable in-place edit: write to a temp file then move over the original
TMP="$(mktemp)"
sed -E "s|^database_id = .*|database_id = \"$ID\"|" wrangler.toml > "$TMP"
mv "$TMP" wrangler.toml

echo "database_id updated: $CURRENT -> $ID"
