#!/bin/bash
# Setup initial - Import de toutes les données

set -e  # Stop on error

echo "=========================================="
echo "🚀 TRACKR - Setup Initial des Données"
echo "=========================================="

cd "$(dirname "$0")/.."

# 1. MyAnimeList
echo ""
echo "📚 [1/5] Import MyAnimeList (manga)..."
node ace import:myanimelist

# 2. AniList
echo ""
echo "📚 [2/5] Import AniList (manga)..."
node ace import:anilist

# 3. MangaDex (manhwa coréens uniquement)
echo ""
echo "📚 [3/5] Import MangaDex (manhwa)..."
node ace import:mangadex --language ko

# 4. GCD (comics)
echo ""
echo "📚 [4/5] Import GCD (comics)..."
node ace import:gcd --auto-download --scrape-covers

# 5. Sync covers vers R2
echo ""
echo "🖼️  [5/5] Sync covers vers R2..."
node ace sync:covers --delay 500

echo ""
echo "=========================================="
echo "✅ Setup terminé !"
echo "=========================================="
