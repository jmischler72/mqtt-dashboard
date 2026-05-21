.PHONY: dev-start dev-restart dev-stop

dev-start:
	docker-compose -f docker-compose-dev.yml up

dev-restart:
	 docker-compose -f docker-compose-dev.yml down && docker volume rm mqtt-dashboard_frontend_node_modules && docker-compose -f docker-compose-dev.yml up --build

dev-stop:
	docker-compose -f docker-compose-dev.yml down