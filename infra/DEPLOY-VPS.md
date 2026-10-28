# Deploy on a single VPS (https://edm.tekomi.vn)

Everything runs in Docker on one server, under one address. The server's own nginx ends HTTPS and proxies the whole
site to one port on `127.0.0.1`. Behind it, a gateway container routes by path:

| Path               | Goes to                                         |
| ------------------ | ----------------------------------------------- |
| `/`                | web app                                         |
| `/api`             | API                                             |
| `/auth`            | Keycloak (sign-in; admin console `/auth/admin`) |
| `/edm-attachments` | photo storage (SeaweedFS, S3 protocol)          |

Files: `docker-compose.prod.yml` + `docker-compose.vps.yml`, `nginx/gateway.conf.template`,
`nginx/host-site.conf.example`, `.env.vps.example`, `scripts/deploy.sh`.

## Server requirements

- Ubuntu/Debian with at least 4 GB RAM (the images are built on the server) and 2 GB of swap is a good idea
- Docker Engine and Docker Compose 2.24 or later (`docker compose version`)
- nginx and certbot (`sudo apt install nginx certbot python3-certbot-nginx`)
- DNS: an `A` record for `edm.tekomi.vn` pointing to the server's IP
- Firewall: only 22, 80 and 443 open (`sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable`)

## First deploy

```bash
# 1. Code
sudo mkdir -p /srv/edm && sudo chown $USER /srv/edm
git clone https://github.com/Tekomi-Technology/EDM-Task-Management.git /srv/edm
cd /srv/edm

# 2. Settings: replace every change-me with `openssl rand -hex 32`
cp infra/.env.vps.example infra/.env.prod
nano infra/.env.prod
chmod 600 infra/.env.prod

# 3. Build and start (first time takes several minutes; Keycloak imports the realm on its first start)
infra/scripts/deploy.sh --no-pull

# 4. nginx in front, then HTTPS
sudo cp infra/nginx/host-site.conf.example /etc/nginx/sites-available/edm.tekomi.vn
sudo ln -s /etc/nginx/sites-available/edm.tekomi.vn /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d edm.tekomi.vn --redirect
```

Check:

```bash
curl -s https://edm.tekomi.vn/api/health
curl -s https://edm.tekomi.vn/auth/realms/edm/.well-known/openid-configuration | head -c 200
```

Give the Keycloak admin sign-in the EDM look too, so it shows the short address `/admin/login` (once; it is kept in
the database):

```bash
infra/scripts/deploy.sh exec keycloak sh -c '/opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080/auth --realm master --user admin --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" && /opt/keycloak/bin/kcadm.sh update realms/master -s loginTheme=edm'
```

Then open `https://edm.tekomi.vn/admin/login`, sign in as `admin` with `KEYCLOAK_ADMIN_PASSWORD`, create the real staff
accounts in realm `edm` and give each one its role (see "Deploy" in the README). Staff sign in at
`https://edm.tekomi.vn/login` (or just `https://edm.tekomi.vn`). The sign-in pages show these short addresses in place
of Keycloak's long sign-in link (`infra/keycloak/themes/edm/login/template.ftl`).

The EDM Field app needs the same addresses: API `https://edm.tekomi.vn`, Keycloak `https://edm.tekomi.vn/auth`.

## Updates

```bash
cd /srv/edm && infra/scripts/deploy.sh
```

It pulls the code, rebuilds the images and recreates only the containers that changed. The API applies database
migrations when it starts.

Other commands go straight to Docker Compose:

```bash
infra/scripts/deploy.sh ps
infra/scripts/deploy.sh logs -f api
infra/scripts/deploy.sh restart keycloak
infra/scripts/deploy.sh down          # stops everything; data stays in the Docker volumes
```

## Backups

Nightly from cron (`crontab -e`):

```
15 2 * * *  cd /srv/edm && COMPOSE_FILE=infra/docker-compose.prod.yml ENV_FILE=infra/.env.prod infra/scripts/backup.sh >> /var/log/edm-backup.log 2>&1
```

Copy `/srv/edm/backups` off the server as well (another machine, object storage).

## Notes and troubleshooting

- **Settings read only on first start:** the Keycloak client secrets and `WEB_PUBLIC_URL` are written into the realm
  when Keycloak first starts, and `POSTGRES_PASSWORD` when the database volume is created. Changing them later in
  `.env.prod` does nothing; change them in the Keycloak admin console or in Postgres.
- **Another port:** if 8090 is taken, set `GATEWAY_PORT` in `.env.prod` and change `proxy_pass` in the nginx site.
- **API cannot reach Keycloak** (`fetch failed` in `logs api`): the API checks tokens at `https://edm.tekomi.vn/auth`,
  so the server must be able to reach its own public address. Test with `curl https://edm.tekomi.vn/auth/` on the
  server. If only containers fail, allow the Docker network in the firewall
  (`sudo ufw allow from 172.16.0.0/12 to any port 443`).
- **Photos fail to load or upload** (`SignatureDoesNotMatch`): the nginx in front must pass `Host $host` unchanged,
  as in `host-site.conf.example`.
