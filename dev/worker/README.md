# MQTT Worker

Test worker for MQTT Dashboard

## What is this ?

This worker is deployed in the development Docker Compose stack and is used to help tests the features of MQTT Dashboard

MQTT Worker — publishes test messages to all three dev brokers also deployed in the dev stack

Two publishing profiles run concurrently:

- IoT simulator : random sensor data on sensors/<room>/<metric> topics
- Simple payloads: incrementing counters on test/<topic> topics

## Environment variables

- PUBLISH_INTERVAL=5
- BROKER_PLAIN_HOST=mosquitto
- BROKER_PLAIN_PORT=1883
- BROKER_PASS_HOST=mosquitto-password
- BROKER_PASS_PORT=1883
- BROKER_PASS_USER=testuser
- BROKER_PASS_PASS=testpass
- BROKER_TLS_HOST=mosquitto-tls
- BROKER_TLS_PORT=8883
- TLS_CA_CERT=/certs/ca.crt
