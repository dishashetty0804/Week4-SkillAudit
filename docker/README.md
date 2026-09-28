# Containers and local object storage

Service Dockerfiles live beside each service. `docker-compose.yml` starts the app, MySQL, Redis, the AI API, and RustFS S3-compatible object storage with one command. The project Dockerfiles use small official base images and the frontend installs its locked dependencies with `npm ci`.

## Start the stack

From the project root, run `docker compose up --build`. Open the app at <http://localhost:3000>, the backend health endpoint at <http://localhost:4000/api/health>, the AI docs at <http://localhost:8000/docs>, the RustFS S3 API at <http://localhost:9000>, and the RustFS console at <http://localhost:9001>. Compose waits for MySQL, Redis, RustFS, and the AI service health checks before starting the backend, then waits for the backend health check before starting the frontend. Local RustFS credentials default to `parking-dev-access` / `parking-dev-secret-please-change`; set `RUSTFS_ACCESS_KEY` and `RUSTFS_SECRET_KEY` to override them. The backend seeds demo data into MySQL and uses it for parking availability and reservation create/list/cancel requests.

## Prove S3 upload and read-back

Keep the stack running, then run from the project root:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r docker/storage/requirements.txt
.\.venv\Scripts\python docker/storage/s3_demo.py
```

The script creates the `parking-demo` bucket, uploads `hello-s3.txt`, lists the bucket, downloads and checks the object, then saves the verified copy to `docker/storage/hello-s3-downloaded.txt`. It uses the RustFS endpoint at `http://localhost:9000` and the credentials from `.env.example`. `S3_ENDPOINT_URL`, `S3_BUCKET`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` can be set to use a different S3-compatible service.

Production image publishing and ECS configuration are described in `docs/AWS_DEPLOYMENT_GUIDE.md`.

## Week 3: build and run the API image

The root `Dockerfile` packages the Node API on the small `node:22-alpine` image. It installs only production dependencies, runs as the unprivileged `node` user, and checks the API health endpoint.

From the project root, build and tag the image:

```powershell
docker build -t smart-parking-api:week3 .
```

Run it in the background:

```powershell
docker run -d --rm --name smart-parking-week3 -p 4010:4000 smart-parking-api:week3
```

In PowerShell, confirm the container and app respond:

```powershell
docker ps --filter name=smart-parking-week3
Invoke-RestMethod http://localhost:4010/api/health
Invoke-RestMethod http://localhost:4010/api/parking/locations
```

The API uses its seeded in-memory demo data when run on its own. Stop and remove the demo container with `docker stop smart-parking-week3`.
