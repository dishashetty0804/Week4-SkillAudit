# AI-Based Smart Parking and Traffic Management

A cloud-ready smart-city parking console with JWT roles, parking discovery, reservations, simulated traffic telemetry, Socket.IO updates, and a FastAPI prediction service. The local experience works without AWS credentials or paid APIs.

## Run locally

Fast path: `cd backend && npm install && npm test`, then `npm start`; in another terminal `cd frontend && npm install && npm run dev`; optionally start the AI service from `ai-service` with `pip install -r requirements.txt && uvicorn main:app --reload --port 8000`. Open `http://localhost:5173`.

Standalone container (Week 3): `docker build -t smart-parking-api:week3 .`, then `docker run --rm -p 4010:4000 smart-parking-api:week3`. Check it at `http://localhost:4010/api/health`. Multi-service path: `docker compose up --build`, then open `http://localhost:3000`. API health: `http://localhost:4000/api/health`. AI docs: `http://localhost:8000/docs`. RustFS S3 API: `http://localhost:9000`; console: `http://localhost:9001`. See [docker/README.md](docker/README.md) for the container verification and bucket upload/read-back demos.

Demo credentials: `driver@parking.local` / `Driver@123`; `operator@parking.local` / `Operator@123`; `admin@parking.local` / `Admin@123`.

See [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md), [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md), and [docs/AWS_DEPLOYMENT_GUIDE.md](docs/AWS_DEPLOYMENT_GUIDE.md). The prediction baseline is deterministic and trained against simulated feature relationships; replace it with persisted scikit-learn artifacts using the documented retraining workflow before production.
