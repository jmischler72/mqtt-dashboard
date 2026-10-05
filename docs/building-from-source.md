# Building from Source

This guide explains how to compile the MQTT Dashboard standalone binary from source or build the Docker image locally.

---

## 📋 Prerequisites

To compile the application locally, you will need:

* **Go**: `1.27+`
* **Node.js**: `22+` (with `npm`)
* **Git**

No external C compiler (GCC/Clang) is required. The SQLite database uses a pure Go implementation (`modernc.org/sqlite`) that compiles natively without CGO across Linux, macOS, and Windows.

---

## 🛠️ Compiling the Standalone Binary

MQTT Dashboard packages the React frontend directly inside the Go executable. The build process consists of compiling the frontend assets and embedding them into the backend binary.

### 1. Clone the Repository

```bash
git clone https://github.com/jmischler72/mqtt-dashboard.git
cd mqtt-dashboard
```

### 2. Build the Frontend

Install dependencies and generate the production SPA bundle:

```bash
cd frontend
npm ci
npm run build
cd ..
```

This creates the production static assets inside `frontend/dist`.

### 3. Embed and Build the Backend

Copy the built frontend assets into `backend/dist` and build the Go binary:

```bash
# Ensure backend/dist exists and is populated with the built frontend
rm -rf backend/dist
cp -r frontend/dist backend/dist

# Build the static, stripped Go binary
cd backend
CGO_ENABLED=0 go build -ldflags="-s -w" -trimpath -o mqtt-dashboard .
```

### 4. Run the Binary

```bash
./mqtt-dashboard
```

By default, the dashboard starts on `http://localhost:8080` with data stored in `./data`.

---

## 🌍 Cross-Compiling

Because `modernc.org/sqlite` does not require CGO, you can easily cross-compile for other operating systems and architectures directly from your workstation:

```bash
# Linux amd64
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -trimpath -o mqtt-dashboard-linux-amd64 .

# Linux arm64 (Raspberry Pi 4 / 5, AWS Graviton)
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -trimpath -o mqtt-dashboard-linux-arm64 .

# macOS Apple Silicon
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -trimpath -o mqtt-dashboard-darwin-arm64 .

# Windows amd64
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -trimpath -o mqtt-dashboard-windows-amd64.exe .
```

---

## 🐳 Building the Docker Image Locally

You can also build the optimized multi-stage production Docker container:

```bash
# Build using BuildKit
docker build -t mqtt-dashboard:local .

# Run the container
docker run -d \
  --name mqtt-dashboard \
  -p 8080:8080 \
  -v mqtt_data:/app/data \
  mqtt-dashboard:local
```

---

## 💻 Local Development Workflow

If you want to contribute or develop features with hot-reloading:

* The repository includes an isolated dev environment powered by Docker Compose, Air (Go hot-reload), Vite HMR, and test Mosquitto brokers.
* See the `Makefile` commands:
  ```bash
  make dev-start   # Starts the isolated dev stack and proxy
  make dev-url     # Prints this worktree's local URL
  make dev-logs    # Follow container logs
  make dev-stop    # Stops the local dev stack
  ```
