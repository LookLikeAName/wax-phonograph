#!/usr/bin/env bash
# 先建置，再把 dist/index.html（單一檔案、全部內嵌）部署到 Cloudflare Pages（網址是 <專案名>.pages.dev）。
# 在專案外的暫存資料夾執行 wrangler，避免 .wrangler 快取（含帳號資訊）留在專案裡。
# 用法（專案根目錄，需先 npx wrangler login）：bash tools/deploy_pages.sh
# 部署到自己的 Cloudflare 帳號時，把 PROJECT 改成自己的專案名稱。
set -euo pipefail
PROJECT=wax-phonograph
root="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$root" && npm run build)
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/dist"; cp "$root/dist/index.html" "$tmp/dist/"
cd "$tmp"
npx --yes wrangler pages deploy dist --project-name "$PROJECT" --branch main --commit-dirty=true
