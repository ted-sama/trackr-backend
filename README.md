## Docker

1. Duplique `.env.example` en `.env`, puis renseigne toutes les variables (Base de données, AWS, Upstash, Gemini). Assure-toi que `HOST=0.0.0.0`, `PORT=3333`. Utilise les mêmes identifiants que `docker-compose.yml` (`DB_USER`, `DB_PASSWORD`, `DB_DATABASE`).
2. Démarre la stack : `docker compose up --build`. Les migrations sont lancées automatiquement (`--force`).
3. Vérifie que l’API répond : `curl http://localhost:3333/` (ou une autre route). Tu dois recevoir un JSON/404 si la route n’existe pas, signe que le serveur tourne.
4. Pour rejouer les migrations manuellement : `docker compose run --rm app node build/ace.js migration:run --force`.
5. Pour importer les données MyAnimeList en conteneur : `docker compose run --rm app node build/ace.js import:myanimelist`.
6. Quand tu as fini : `docker compose down` (ajoute `-v` si tu veux réinitialiser le volume Postgres).
