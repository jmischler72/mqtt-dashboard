.PHONY: dev-start dev-restart dev-stop

dev-start:
	./docker/dev/setup-dev-env.sh
	docker-compose -f ./docker/dev/docker-compose-dev.yml up -d 

dev-restart:
	./docker/dev/setup-dev-env.sh
	docker-compose -f ./docker/dev/docker-compose-dev.yml down && docker volume rm dev_frontend_node_modules || true && docker-compose -f ./docker/dev/docker-compose-dev.yml up --build -d

dev-stop:
	docker-compose -f ./docker/dev/docker-compose-dev.yml down


