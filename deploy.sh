#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env.prod" ]]; then
  echo "Missing .env.prod. Copy .env.prod.example and edit it first."
  exit 1
fi

set -a
source ".env.prod"
set +a

if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg lsb-release
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER" || true
fi

mkdir -p certs
if [[ ! -f "certs/auth-private.pem" || ! -f "certs/auth-public.pem" ]]; then
  openssl genpkey -algorithm RSA -out certs/auth-private.pem -pkeyopt rsa_keygen_bits:2048
  openssl rsa -pubout -in certs/auth-private.pem -out certs/auth-public.pem
fi

export AUTH_PRIVATE_KEY="$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' certs/auth-private.pem)"
export AUTH_PUBLIC_KEY="$(awk 'NF {sub(/\r/, ""); printf "%s\\n",$0;}' certs/auth-public.pem)"

ENABLE_TLS="${ENABLE_TLS:-false}"
if [[ "$ENABLE_TLS" == "true" ]]; then
  if [[ -z "${DOMAIN_NAME:-}" ]]; then
    echo "ENABLE_TLS=true requires DOMAIN_NAME in .env.prod"
    exit 1
  fi
  export GATEWAY_NGINX_CONF=./nginx/nginx.prod.conf
  if [[ ! -d "/etc/letsencrypt/live/${DOMAIN_NAME}" ]]; then
    sudo apt-get update
    sudo apt-get install -y certbot
    sudo certbot certonly --standalone -d "${DOMAIN_NAME}" --non-interactive --agree-tos -m "admin@${DOMAIN_NAME}"
  fi
  HEALTH_URL="https://${DOMAIN_NAME}/api/health"
  DOCS_URL="https://${DOMAIN_NAME}/docs"
else
  if [[ -z "${PUBLIC_IP:-}" ]]; then
    echo "For IP-only deploy, set PUBLIC_IP in .env.prod"
    exit 1
  fi
  export GATEWAY_NGINX_CONF=./nginx/nginx.ip.conf
  HEALTH_URL="http://${PUBLIC_IP}/api/health"
  DOCS_URL="http://${PUBLIC_IP}/docs"
fi

docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env.prod down --remove-orphans
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env.prod ps

echo "Deployment complete."
echo "Health: ${HEALTH_URL}"
echo "Docs:   ${DOCS_URL}"
