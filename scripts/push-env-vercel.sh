#!/usr/bin/env bash
# Pushes every key in .env.local to Vercel for production+preview+development.
# Skips empty lines and comments. Idempotent: removes the existing var first
# so re-running updates the value.
set -euo pipefail

ENV_FILE=".env.local"
ENVIRONMENTS=("production" "preview" "development")

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE"; exit 1
fi

# Read line by line, handling values that may contain spaces / quotes.
while IFS= read -r line || [[ -n "$line" ]]; do
  # Skip blanks and comments
  [[ -z "${line// }" ]] && continue
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  key="${line%%=*}"
  value="${line#*=}"
  # Strip surrounding double quotes if present
  if [[ "$value" =~ ^\".*\"$ ]]; then
    value="${value:1:-1}"
  fi

  for env in "${ENVIRONMENTS[@]}"; do
    # Use --force to overwrite, --yes to skip confirm, --value to avoid stdin
    # prompts. For preview, omit git-branch which defaults to all branches when
    # --value is passed in non-interactive mode.
    if vercel env add "$key" "$env" --value "$value" --force --yes </dev/null >/dev/null 2>&1; then
      echo "  ✓ $key ($env)"
    else
      echo "  ✗ $key ($env) failed" >&2
    fi
  done
done < "$ENV_FILE"

echo "Done."
