.PHONY: dev build docker clean

dev:
	docker-compose up

build:
	cd frontend && npm run build
	cd backend && go build -o ../mqtt-dashboard .

docker:
	docker build -t mqtt-dashboard:latest .

clean:
	rm -f mqtt-dashboard
	rm -rf backend/tmp
	rm -rf frontend/dist
