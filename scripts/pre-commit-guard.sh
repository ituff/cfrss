#!/usr/bin/env bash
# Guard: refuse to commit a real D1 database_id.
#
# wrangler.toml is committed with a placeholder id; the real one is injected
# locally by scripts/set-d1-id.sh. Because the file is tracked, a plain
# `git add wrangler.toml` would stage the injected value — this hook stops that.
#
# To install:  cp scripts/pre-commit-guard.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

set -euo pipefail

PLACEHOLDER="00000000-0000-0000-0000-000000000000"

# Only inspect what is actually being committed
if git diff --cached --name-only | grep -qx "wrangler.toml"; then
  # `git show :file` reads the staged (index) version
  STAGED_ID="$(git show :wrangler.toml 2>/dev/null | grep -E '^database_id' | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"

  if [[ -n "$STAGED_ID" && "$STAGED_ID" != "$PLACEHOLDER" ]]; then
    cat >&2 <<EOF
✖ 拒绝提交：wrangler.toml 的 database_id 不是占位符。

    暂存值: $STAGED_ID
    应为:   $PLACEHOLDER

  真实 id 由 scripts/set-d1-id.sh 本地注入，不应入库。
  若你确实要提交 wrangler.toml 的其他改动，请只暂存需要的行：

      git reset HEAD wrangler.toml
      git add -p wrangler.toml

EOF
    exit 1
  fi
fi

exit 0
