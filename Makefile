.PHONY: dev-start dev-restart dev-stop

dev-start:
	./dev/setup-dev-env.sh
	docker-compose -f ./dev/docker-compose-dev.yml up -d 

dev-restart:
	./dev/setup-dev-env.sh
	docker-compose -f ./dev/docker-compose-dev.yml down && docker volume rm dev_frontend_node_modules || true && docker-compose -f ./dev/docker-compose-dev.yml up --build -d

dev-stop:
	docker-compose -f ./dev/docker-compose-dev.yml down

