.PHONY: dev restart-dev

dev:
	docker-compose -f docker-compose-dev.yml up

restart-dev:
	 docker-compose -f docker-compose-dev.yml down && docker volume rm mqtt-dashboard_frontend_node_modules && docker-compose -f docker-compose-dev.yml up --build
