# Deploy on a single VPS (https://edm.tekomi.vn)

Two parts, each started on its own with Docker Compose:

| Part                     | Folder     | Containers                                         |
| ------------------------ | ---------- | -------------------------------------------------- |
| Backend                  | `apps/api` | API, Postgres (PostGIS), Redis, photo storage (S3) |
| Web app (sign-in, pages) | `apps/web` | nginx with the built pages                         |

The server's own nginx ends HTTPS for `edm.tekomi.vn` and sends each path to its part, on ports of `127.0.0.1`
only (nothing else is reachable from outside):

| Path                | Goes to                         | Port (setting)                                |
| ------------------- | ------------------------------- | --------------------------------------------- |
| `/api/`             | API                             | 8091 (`API_HOST_PORT` in `apps/api/.env`)     |
| `/edm-attachments/` | photo storage (presigned links) | 8093 (`STORAGE_HOST_PORT` in `apps/api/.env`) |
| everything else     | web app                         | 8090 (`WEB_HOST_PORT` in `apps/web/.env`)     |

## Server requirements

- Ubuntu/Debian with at least 4 GB RAM (the images are built on the server) and 2 GB of swap is a good idea
- Docker Engine and Docker Compose 2.24 or later (`docker compose version`)
- nginx and certbot
- DNS: an `A` record for `edm.tekomi.vn` pointing to the server's IP
- Firewall: only 22, 80 and 443 open

## First deploy

```bash
# 1. Code
git clone https://github.com/Tekomi-Technology/EDM-Task-Management.git
cd EDM-Task-Management

# 2. Backend: settings (replace every change-me with `openssl rand -hex 32`), then build and start
cp apps/api/.env.example apps/api/.env && chmod 600 apps/api/.env && nano apps/api/.env
cd apps/api && docker compose up -d --build && cd ../..

# 3. Web app
cp apps/web/.env.example apps/web/.env && nano apps/web/.env
cd apps/web && docker compose up -d --build && cd ../..
```

4. The server's nginx: the site below in `/etc/nginx/conf.d/edm.conf` (or `sites-available` on Debian's nginx), then
   `sudo nginx -t && sudo systemctl reload nginx` and `sudo certbot --nginx -d edm.tekomi.vn --redirect`, which adds
   the HTTPS lines.

```nginx
server {
  listen 80;
  server_name edm.tekomi.vn;

  # Photo uploads from the app.
  client_max_body_size 50m;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;

  location /api/ {
    proxy_pass http://127.0.0.1:8091;
    proxy_read_timeout 120s;
  }

  # Photos: presigned S3 links (https://edm.tekomi.vn/edm-attachments/…). The path and the Host header are part of
  # the signature, so both pass unchanged; uploads stream straight through.
  location /edm-attachments/ {
    proxy_pass http://127.0.0.1:8093;
    # Exactly as the browser sent it, port included ($host drops the port).
    proxy_set_header Host $http_host;
    proxy_request_buffering off;
    proxy_buffering off;
  }

  location / {
    proxy_pass http://127.0.0.1:8090;
  }
}
```

Check: `curl -s https://edm.tekomi.vn/api/health`.

The first administrator gets a temporary password from the server's command line (also the way back in when nobody
can sign in as an administrator):

```bash
cd apps/api && docker compose exec api node dist/db/set-password.js admin.edm --admin "Admin EDM"
```

Open `https://edm.tekomi.vn`, sign in with it and choose your own password. Then, in Settings:

- **Areas and teams:** draw the areas (or read EDM's boundaries from a GeoJSON file) and make their teams;
- **Users & roles:** the staff accounts, each with a temporary password to give to the person;
- **API keys:** one key for each other system (Call Center, Sales, NMS, stock), given to the team running it;
- **Sign-in security:** password length, locking after wrong passwords, how long people stay signed in.

The EDM Field app needs the same address for its API: `https://edm.tekomi.vn`.

## Updates

```bash
git pull
cd apps/api && docker compose up -d --build     # backend (applies database migrations on start)
cd ../web   && docker compose up -d --build     # web app
```

Only the part that changed needs to be rebuilt. Other commands, in the part's folder:

```bash
docker compose ps
docker compose logs -f api
docker compose restart api
docker compose down          # stops the part; data stays in the Docker volumes
```

## From the old layout (`infra/`, one time)

Servers set up before the split ran everything from `infra/` with `infra/scripts/deploy.sh`. The data volumes keep
their names (`edm-prod_postgres-data`, `edm-prod_redis-data`, `edm-prod_storage-data`), so nothing is lost.

```bash
git pull
# Settings: the old file keeps working as it is; add the ports and AUTH_SECRET if missing
cp infra/.env.prod apps/api/.env && chmod 600 apps/api/.env
printf '\nAPI_HOST_PORT=8091\nSTORAGE_HOST_PORT=8093\n' >> apps/api/.env
grep -q '^AUTH_SECRET=' apps/api/.env || echo "AUTH_SECRET=$(openssl rand -hex 32)" >> apps/api/.env
printf 'WEB_PUBLIC_URL=https://edm.tekomi.vn\nWEB_HOST_PORT=8090\n' > apps/web/.env

# Backend; --remove-orphans takes away the old gateway, web and Keycloak containers
cd apps/api && docker compose up -d --build --remove-orphans
cd ../web && docker compose up -d --build
```

Then change the server's nginx site to the one above (keep the HTTPS lines certbot added), `sudo nginx -t` and
`sudo systemctl reload nginx`. Once everything works, `rm -r infra` removes the old settings file.

## Backups

Nightly from cron (`crontab -e`), with the full path of the repository:

```
15 2 * * *  /root/EDM-Task-Management/apps/api/scripts/backup.sh >> /var/log/edm-backup.log 2>&1
```

Backups go to `apps/api/backups`; copy them off the server as well (another machine, object storage).

## Notes and troubleshooting

- **Settings read only on first start:** `POSTGRES_PASSWORD` is set when the database volume is created; changing it
  later in `.env` does nothing (change it in Postgres). Changing `AUTH_SECRET` signs everyone out.
- **Another port:** if 8090, 8091 or 8093 is taken, change it in the `.env` and in the nginx site.
- **Photos fail to load or upload** (403, `SignatureDoesNotMatch`): nginx must pass the Host header exactly as the
  browser sent it (`proxy_set_header Host $http_host;` in the photo location).
- **Sign-in attempts are limited per address:** nginx must send `X-Forwarded-For` (as above), or every visitor
  counts as the same address.
