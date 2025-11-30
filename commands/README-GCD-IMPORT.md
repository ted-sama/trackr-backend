# Import GCD (Grand Comics Database)

Script pour importer les comics depuis la base de données GCD dans Trackr.

## Prérequis

1. **Télécharger la base de données GCD**
   - Créer un compte sur https://www.comics.org/
   - Aller sur https://www.comics.org/download/
   - Télécharger le dump **SQLite** (fichier `.gz`)

2. **Transférer la DB sur le serveur**

### Option A : Via SCP (recommandé)

```bash
# Depuis ton Mac
scp ~/Downloads/gcd-sqlite-*.gz user@ton-vps:/tmp/gcd-data/

# Sur le VPS
cd /tmp/gcd-data
gunzip gcd-sqlite-*.gz
mv gcd-sqlite-* gcd.db
```

### Option B : Via URL directe

Si tu uploades le fichier quelque part (S3, serveur web, etc.), le script peut le télécharger automatiquement :

```bash
node ace import:gcd --db-url="https://example.com/gcd.db.gz"
```

## Exécution

### Import basique

```bash
# Utilise le chemin par défaut /tmp/gcd-data/gcd.db
node ace import:gcd
```

### Avec un chemin personnalisé

```bash
# Via variable d'environnement
export GCD_DB_PATH=/chemin/vers/gcd.db
node ace import:gcd

# Ou dans le fichier .env
GCD_DB_PATH=/chemin/vers/gcd.db
```

### Test avec limite

```bash
# Importer seulement 100 comics (pour tester)
node ace import:gcd --limit=100
```

### Import + Scraping des covers

```bash
# Import puis scrape les covers depuis le site GCD
node ace import:gcd --scrape-covers
```

### Scraping des covers uniquement

```bash
# Si l'import est déjà fait, juste récupérer les covers manquantes
node ace import:gcd --covers-only

# Avec un délai personnalisé (en ms)
node ace import:gcd --covers-only --delay=5000

# Reprendre à partir du Nème livre
node ace import:gcd --covers-only --skip=500
```

## Flags disponibles

| Flag | Description |
|------|-------------|
| `--limit <n>` | Limite le nombre de comics à importer |
| `--db-url <url>` | URL directe pour télécharger la DB (.gz ou .db) |
| `--scrape-covers` | Scrape les covers après l'import |
| `--covers-only` | Mode covers uniquement (skip l'import) |
| `--delay <ms>` | Délai entre les requêtes de scraping (défaut: 3000) |
| `--skip <n>` | Skip les N premiers livres (pour reprendre le scraping) |

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `GCD_DB_PATH` | Chemin vers la base de données SQLite | `/tmp/gcd-data/gcd.db` |
| `GCD_DOWNLOAD_DIR` | Dossier de téléchargement | `/tmp/gcd-data` |

## Ce que fait le script

1. **Import des publishers** (Marvel, DC, Image, etc.)
2. **Import des comics** avec filtres :
   - Année >= 1980
   - Plus de 1 issue
   - Exclut les compilations (Omnibus, Essential, etc.)
   - Exclut les magazines et adaptations films
3. **Déduplication des noms** : Ajoute l'année aux comics avec le même nom
   - Ex: "The Amazing Spider-Man" → "The Amazing Spider-Man (2022)"
4. **Comics en cours** : `chapters = null` pour les comics sans `end_year`
5. **Scraping des covers** (optionnel) depuis le site GCD

## Commande de fix

Si tu as déjà fait un import et que tu veux corriger les données :

```bash
# Voir ce qui serait modifié
node ace fix:duplicate-comics --dry-run

# Appliquer les corrections
node ace fix:duplicate-comics
```

Cette commande :
- Met `chapters = null` pour les comics en cours
- Ajoute l'année aux titres dupliqués

## Publishers importés

Le script importe uniquement ces éditeurs :
- Marvel Comics (54)
- DC Comics (78)
- Image Comics (709)
- Dark Horse Comics (512)
- IDW Publishing (1977)
- Boom! Studios (2547)
- Dynamite Entertainment (865)
- Vertigo (370)
- Aftershock Comics (17792)
- Valiant Comics (674)

