#!/usr/bin/env bash
# Packs the Claude Desktop extension into dist/money-desk.mcpb and prints its SHA-256.
set -euo pipefail
cd "$(dirname "$0")/.."
cp app/parser.js claude-extension/server/parser.js
mkdir -p dist
npx --yes @anthropic-ai/mcpb@2.1.2 pack claude-extension dist/money-desk.mcpb
rm claude-extension/server/parser.js
sha256sum dist/money-desk.mcpb
