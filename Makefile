COMPOSE := docker compose -f ./docker/dev/docker-compose-dev.yml
PROXY_COMPOSE := docker compose -p mqtt-dev-proxy -f ./docker/dev/proxy/docker-compose-proxy.yml
# Populated by docker/dev/setup-dev-env.sh; empty until `make dev-start` has run once
DEV_URL = $(shell sed -n 's/^DEV_URL=//p' ./docker/dev/.env 2>/dev/null)

.PHONY: dev-start dev-restart dev-stop dev-url dev-ps dev-logs dev-pub proxy-stop

dev-start:
	./docker/dev/setup-dev-env.sh
	$(COMPOSE) up -d
	@$(MAKE) --no-print-directory dev-url

dev-restart:
	./docker/dev/setup-dev-env.sh
	$(COMPOSE) down -v
	$(COMPOSE) up --build -d
	@$(MAKE) --no-print-directory dev-url

dev-stop:
	$(COMPOSE) down

# Print this worktree's dev URL
dev-url:
	@echo "$(DEV_URL)"

dev-ps:
	@$(COMPOSE) ps

# Usage: make dev-logs [SERVICE=mqtt-dashboard-app]
dev-logs:
	@$(COMPOSE) logs -f --tail=100 $(SERVICE)

# Publish a test message to this worktree's anonymous broker
# Usage: make dev-pub TOPIC=test/foo MSG=hello
dev-pub:
	@$(COMPOSE) exec -T mosquitto mosquitto_pub -h localhost -t "$(TOPIC)" -m "$(MSG)"

# Stop the shared Traefik proxy (affects every worktree)
proxy-stop:
	$(PROXY_COMPOSE) down
