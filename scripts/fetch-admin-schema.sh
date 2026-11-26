#!/usr/bin/env bash
# Télécharge le schéma Admin GraphQL (2026-10) publié dans le paquet npm @shopify/dev-mcp,
# pour valider hors ligne les requêtes de l'application (tests).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)/.cache"
mkdir -p "$DIR" && TMP="$(mktemp -d)" && cd "$TMP"
npm pack @shopify/dev-mcp --silent >/dev/null
tar xzf shopify-dev-mcp-*.tgz package/dist/data/admin_2026-10.json.gz
gunzip -c package/dist/data/admin_2026-10.json.gz > "$DIR/admin_2026-10.json"
rm -rf "$TMP"
echo "Schéma écrit dans $DIR/admin_2026-10.json"
