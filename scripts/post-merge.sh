#!/bin/bash
# Post-merge hook: runs after every git pull/merge
# Reinstalls deps if package.json changed

if git diff HEAD@{1} HEAD --name-only | grep -q "package.json\|pnpm-lock.yaml"; then
  echo "Package files changed, running pnpm install..."
  pnpm install
fi
