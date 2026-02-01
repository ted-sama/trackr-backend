#!/bin/bash
# Mise à jour régulière + remplacement des covers GCD par Issue #1

set -e  # Stop on error

echo "=========================================="
echo "🔄 TRACKR - Update + Force GCD Covers"
echo "=========================================="

cd "$(dirname "$0")/.."

# 1. MyAnimeList
echo ""
echo "📚 [1/5] Update MyAnimeList (manga)..."
node ace import:myanimelist

# 2. AniList
echo ""
echo "📚 [2/5] Update AniList (manga)..."
node ace import:anilist

# 3. MangaDex (manhwa coréens uniquement)
echo ""
echo "📚 [3/5] Update MangaDex (manhwa)..."
node ace import:mangadex --language ko

# 4. GCD (comics) - avec update + force covers Issue #1
echo ""
echo "📚 [4/5] Update GCD (comics) + force Issue #1 covers..."
node ace import:gcd --auto-download --update --scrape-covers --force-covers

# 5. Sync nouvelles covers vers R2
echo ""
echo "🖼️  [5/5] Sync covers vers R2..."
node ace sync:covers --delay 500

echo ""
echo "=========================================="
echo "✅ Mise à jour terminée !"
echo "=========================================="
