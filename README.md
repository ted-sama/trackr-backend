## Docker

1. Create a `.env` file with the required environment variables. For local development you can base it on staging values and adjust, making sure to use the same database credentials as `docker-compose.yml`.
2. Build and run the stack: `docker compose up --build`.
3. Apply migrations automatically during startup (handled by the compose command). To run them manually use `docker compose run --rm app node build/ace.js migration:run`.
4. Access the API at `http://localhost:3333`.
5. When finished stop the containers with `docker compose down`.
