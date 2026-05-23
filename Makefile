.PHONY: dev-start dev-restart dev-stop

dev-start:
	docker-compose -f ./dev/docker-compose-dev.yml up -d 

dev-restart:
	 docker-compose -f ./dev/docker-compose-dev.yml down && docker volume rm mqtt-dashboard_frontend_node_modules || true && docker-compose  -f ./dev/docker-compose-dev.yml up --build -d

dev-stop:
	docker-compose -f ./dev/docker-compose-dev.yml down