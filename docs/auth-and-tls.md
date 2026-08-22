# Authentication & TLS Configuration

This document explains the broker connection security options available in MQTT Dashboard — how each mode works end-to-end from the UI through to the backend MQTT client, and how to test them with the dev docker-compose setup.

## Overview

Security is split into two independent settings per broker:

| Setting                | What it controls                                                         |
| ---------------------- | ------------------------------------------------------------------------ |
| **TLS / SSL toggle**   | Encrypts the TCP connection between the dashboard backend and the broker |
| **Authentication tab** | How the dashboard identifies itself to the broker after connecting       |

They are fully orthogonal — any combination is valid (e.g. TLS without auth, plain TCP with username/password).

---

## TLS / SSL Encryption

### What it does

When enabled, the backend opens a `tls://host:port` connection instead of `tcp://host:port`. The broker must be configured with a server certificate. The dashboard backend acts as a TLS client and validates the server's certificate chain.

### UI options

After toggling **TLS / SSL** on in the broker config form, two extra options appear:

- **CA Certificate** — PEM text of the Certificate Authority that signed the broker's server certificate. Required if the broker uses a self-signed or private CA. If omitted, Go's system CA store is used.
- **Skip TLS verification** — Disables server certificate validation entirely. Useful for quick local testing, but insecure in production.

The port field auto-suggests `8883` when TLS is enabled (standard MQTT-over-TLS port) and reverts to `1883` when disabled.

### Backend code (`backend/mqtt/client.go`)

```go
scheme := "tcp"
if broker.TLSEnabled {
    scheme = "tls"
}
brokerAddr := fmt.Sprintf("%s://%s:%d", scheme, broker.Host, broker.Port)
```

When TLS is enabled a `crypto/tls.Config` is assembled:

```go
tlsCfg := &tls.Config{
    InsecureSkipVerify: broker.TLSSkipVerify,
}

// Custom CA pool
if broker.CACert != "" {
    pool := x509.NewCertPool()
    pool.AppendCertsFromPEM([]byte(broker.CACert))
    tlsCfg.RootCAs = pool
}

// mTLS client certificate
if broker.ClientCert != "" && broker.ClientKey != "" {
    cert, _ := tls.X509KeyPair([]byte(broker.ClientCert), []byte(broker.ClientKey))
    tlsCfg.Certificates = []tls.Certificate{cert}
}

opts.SetTLSConfig(tlsCfg)
```

The paho MQTT client interprets the `tls://` scheme and uses the provided config for the handshake.

### Certificate storage

All certificate content (CA cert, client cert, client key) is stored as PEM text in the `mqtt_brokers` SQLite table. The API never returns certificate content in responses — only boolean flags `has_ca_cert` and `has_client_cert` tell the frontend whether a cert is already configured.

---

## Authentication Modes

### None (anonymous)

**`auth_mode = "none"`**

No credentials are sent. The broker must allow anonymous connections (`allow_anonymous true` in Mosquitto).

**Backend behavior:** Neither `SetUsername()` nor `SetPassword()` are called. The switch statement on `auth_mode` simply falls through.

**Mosquitto config:**

```
allow_anonymous true
```

---

### Username / Password

**`auth_mode = "password"`**

Standard MQTT credential authentication (CONNECT packet carries username + password). The broker validates credentials against its configured auth backend.

**Backend behavior:**

```go
case "password":
    if broker.Username != "" {
        opts.SetUsername(broker.Username)
    }
    if broker.Password != "" {
        opts.SetPassword(broker.Password)
    }
```

**Security note:** Passwords are stored in plaintext in SQLite (never returned by the API via `json:"-"`). Without TLS, credentials are sent in cleartext over the network — use TLS + password for real deployments.

**Mosquitto config:**

```
allow_anonymous false
password_file /mosquitto/config/passwd
```

Generate the passwd file:

```bash
docker run --rm eclipse-mosquitto:2 mosquitto_passwd -b -c /dev/stdout testuser testpass > passwd
```

---

### Client Certificate (mTLS)

**`auth_mode = "certificate"`**

Mutual TLS authentication. During the TLS handshake, the client presents a certificate that the broker verifies against its configured CA. No MQTT-level username/password is involved.

**Requirements:**

- TLS must be enabled on the broker config
- A **Client Certificate** (PEM) must be provided
- A **Client Key** (PEM) must be provided
- The broker must have `require_certificate true` and a `cafile` pointing to the CA that signed the client certificate

**Backend behavior:** The client cert and key are loaded into the `tls.Config.Certificates` slice (see TLS section above). The `"certificate"` auth mode does not set any username/password.

**Mosquitto config:**

```
require_certificate true
cafile /mosquitto/certs/ca.crt
certfile /mosquitto/certs/server.crt
keyfile /mosquitto/certs/server.key
```

---

## Dev Docker Compose Brokers

`docker/dev/docker-compose-dev.yml` provides three Mosquitto instances, one for each connection type:

| Service | Host (in-container) | Port | Auth | TLS |
| ------- | ------------------- | ---- | ---- | --- |
| `mosquitto` | `mosquitto` | `1883` | None | No |
| `mosquitto-password` | `mosquitto-password` | `1884` (in container: 1883) | Username / Password | No |
| `mosquitto-tls` | `mosquitto-tls` | `8883` | None or Client Cert | Yes |

From the **host machine**, connect to `localhost`.

---

### mosquitto — Anonymous, plain TCP

Connect with:

- **Host:** `localhost` (or `mosquitto` from inside the app container)
- **Port:** `1883`
- **Auth:** None
- **TLS:** Off

No setup required.

---

### mosquitto-password — Password auth, plain TCP

**One-time setup:**

```bash
chmod +x docker/dev/mosquitto/passwd/setup-passwd.sh
./docker/dev/mosquitto/passwd/setup-passwd.sh
```

This generates `docker/dev/mosquitto/passwd/passwd` with credentials `testuser` / `testpass`.

Connect with:

- **Host:** `localhost` (or `mosquitto-password` from inside container on port 1883)
- **Port:** `1884`
- **Auth:** Username / Password → `testuser` / `testpass`
- **TLS:** Off

---

### mosquitto-tls — TLS (and optional mTLS)

**One-time setup — generate certificates:**

```bash
chmod +x docker/dev/mosquitto/certs/generate.sh
./docker/dev/mosquitto/certs/generate.sh
```

Files created in `docker/dev/mosquitto/certs/`:

- `ca.crt` — Root CA (used by both server and client)
- `server.key` / `server.crt` — Server certificate (used by Mosquitto, SAN includes `mosquitto-tls` and `localhost`)
- `client.key` / `client.crt` — Client certificate for mTLS testing

#### TLS with CA verification

Connect with:

- **Host:** `localhost` (or `mosquitto-tls` inside container)
- **Port:** `8883`
- **Auth:** None
- **TLS:** On
- **CA Certificate:** paste the contents of `docker/dev/mosquitto/certs/ca.crt`

#### TLS — skip verification (quick test)

Connect with:

- **Host:** `localhost` (or `mosquitto-tls` inside container)
- **Port:** `8883`
- **TLS:** On, **Skip TLS verification:** checked
- **Auth:** None

#### Mutual TLS (client certificate)

Edit `docker/dev/mosquitto/config/mosquitto-tls.conf` and change:

```
require_certificate false
```

→

```
require_certificate true
```

Then restart `mosquitto-tls`:

```bash
docker compose -f docker/dev/docker-compose-dev.yml restart mosquitto-tls
```

Connect with:

- **Host:** `localhost` (or `mosquitto-tls` inside container)
- **Port:** `8883`
- **TLS:** On
- **CA Certificate:** paste `docker/dev/mosquitto/certs/ca.crt`
- **Auth:** Client Certificate
  - **Client Certificate:** paste `docker/dev/mosquitto/certs/client.crt`
  - **Client Key:** paste `docker/dev/mosquitto/certs/client.key`

