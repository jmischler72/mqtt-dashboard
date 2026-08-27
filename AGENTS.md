## Dev environment

Each git worktree runs its **own** isolated stack (app + 3 mosquitto brokers + publisher
worker). Several worktrees can run at the same time without conflicting.

```sh
make dev-start     # start this worktree's stack (also starts the shared proxy)
make dev-url       # print this worktree's URL
make dev-ps        # container status
make dev-logs      # follow logs (SERVICE=mqtt-dashboard-app to narrow)
make dev-restart   # rebuild from scratch
make dev-stop      # stop this worktree only
```

**Accessing the app.** Nothing is published on `localhost:5173` / `localhost:8080` anymore.
The app is served at `http://<worktree-directory-name>.localhost` — for this worktree,
`http://chore-handle-multiple-dev-env.localhost`. `make dev-url` prints it; it is also in
`docker/dev/.env` as `DEV_URL`. The API and WebSocket live on that same origin:

```sh
curl -sS "$(make -s dev-url)/api/brokers"
# http://<slug>.localhost/api/...   and   ws://<slug>.localhost/ws
```

`http://traefik.localhost` lists every dev environment currently running.

**Brokers are not published to the host, by design** — they only exist on this worktree's
Docker network, which is what keeps worktrees isolated. To publish a test message:

```sh
make dev-pub TOPIC=test/foo MSG=hello
# or, for the password / TLS brokers:
docker compose -f docker/dev/docker-compose-dev.yml exec mosquitto-password \
  mosquitto_pub -h localhost -u testuser -P testpass -t test/foo -m hello
```

Always invoke Compose with `-f docker/dev/docker-compose-dev.yml` so the generated
`docker/dev/.env` (project name `mqttdash-<slug>`, hostname) is picked up. See
[`docs/auth-and-tls.md`](docs/auth-and-tls.md) for the broker matrix.

## Frontend

- use daisyui components
- Avoid calling `setState` synchronously inside `useEffect`. Never use effects to sync or duplicate state; use derived state/inline computation instead to prevent cascading renders.
- dont create tests for frontend unless explicited

## Task Tracking

- Task tracking has transitioned to **GitHub Issues**.
- Legacy tasks are archived in [`docs/TODO.old.md`](docs/TODO.old.md).
