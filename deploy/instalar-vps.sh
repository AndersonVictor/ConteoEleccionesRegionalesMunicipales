#!/usr/bin/env bash
# Instala la app completa en un VPS nuevo con Ubuntu 22.04/24.04 (como root):
#   curl -fsSL https://raw.githubusercontent.com/AndersonVictor/ConteoEleccionesRegionalesMunicipales/main/deploy/instalar-vps.sh | bash
# También se puede pegar como "user data / cloud-init" al crear el servidor (definiendo antes
# DOMINIO, DECOLECTA_TOKEN y ADMIN_DNIS al inicio del script).
set -euo pipefail

REPO="${REPO:-https://github.com/AndersonVictor/ConteoEleccionesRegionalesMunicipales.git}"
RAMA="${RAMA:-main}"
DIR=/opt/conteo

# Servidores con menos de 2 GB de RAM (p. ej. Scaleway Stardust, 1 GB): modo liviano, sin Docker.
# La app corre como un solo proceso con SQLite y Caddy da HTTPS. MODO=completo|liviano lo fuerza.
RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
# Con 1 vCPU tampoco conviene Docker: Postgres y las réplicas compiten por el mismo núcleo.
MODO="${MODO:-$([ "$RAM_MB" -lt 1900 ] || [ "$(nproc)" -lt 2 ] && echo liviano || echo completo)}"
# Memoria máxima para Node según la RAM del servidor (512 MB de RAM -> 256 MB para la app).
NODE_MEM=$([ "$RAM_MB" -lt 900 ] && echo 256 || echo 512)
echo "==> RAM: ${RAM_MB} MB -> modo $MODO"

apt-get update -qq
apt-get install -y -qq git curl ca-certificates openssl >/dev/null

if [ "$MODO" = completo ] && ! command -v docker >/dev/null; then
  echo "==> Instalando Docker"
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Descargando la app ($RAMA)"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone --depth 1 -b "$RAMA" "$REPO" "$DIR"; fi
cd "$DIR"

if [ ! -f .env ]; then
  echo "==> Configurando .env"
  pregunta() { local v="${!1:-}"; if [ -z "$v" ] && [ -t 0 ]; then read -rp "$2: " v; fi; echo "$v"; }
  DOMINIO=$(pregunta DOMINIO "Dominio que apunta a este servidor (ej. conteo.midominio.pe)")
  DECOLECTA_TOKEN=$(pregunta DECOLECTA_TOKEN "Token de Decolecta (Enter para omitir)")
  ADMIN_DNIS=$(pregunta ADMIN_DNIS "DNI del administrador")
  cat > .env <<ENV
DOMINIO=${DOMINIO}
DECOLECTA_TOKEN=${DECOLECTA_TOKEN}
ADMIN_DNIS=${ADMIN_DNIS}
SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
ELECCION_INICIO=2026-10-04T08:00:00-05:00
ENV
  chmod 600 .env
fi

if [ "$MODO" = liviano ]; then
  echo "==> Modo liviano: Node.js 22 + Caddy + SQLite"
  # Memoria de intercambio para no quedarse sin RAM en picos.
  if ! swapon --show | grep -q .; then
    fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
    grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  fi
  apt-get install -y -qq caddy >/dev/null
  npm ci --omit=dev --no-audit --no-fund
  id conteo >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin conteo
  mkdir -p data respaldos && chown -R conteo:conteo data respaldos .env
  cat > /etc/systemd/system/conteo.service <<UNIT
[Unit]
Description=Conteo ERM 2026
After=network.target

[Service]
User=conteo
WorkingDirectory=$DIR
Environment=NODE_ENV=production PORT=3000 HOST=127.0.0.1
ExecStart=/usr/bin/node --max-old-space-size=$NODE_MEM --disable-warning=ExperimentalWarning server/index.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
  . ./.env
  cat > /etc/caddy/Caddyfile <<CADDY
${DOMINIO:-:80} {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
CADDY
  systemctl daemon-reload
  systemctl enable --now conteo >/dev/null
  systemctl restart caddy
  if command -v ufw >/dev/null; then ufw allow OpenSSH >/dev/null; ufw allow 80,443/tcp >/dev/null; ufw --force enable >/dev/null; fi
  echo
  echo "Listo (modo liviano). Abre https://${DOMINIO}"
  echo "Estado:    systemctl status conteo"
  echo "Registros: journalctl -u conteo -f"
  echo "Respaldo:  bash deploy/respaldo.sh   (hazlo ANTES de borrar el servidor)"
  exit 0
fi

# Réplicas según los núcleos del servidor (Postgres, Nginx y Redis también necesitan CPU).
NUCLEOS=$(nproc)
CONTEO=$(( NUCLEOS > 2 ? NUCLEOS - 2 : 1 ))
RESULTADOS=$(( NUCLEOS >= 4 ? 2 : 1 ))

echo "==> Iniciando ($NUCLEOS núcleos: conteo x$CONTEO, resultados x$RESULTADOS)"
docker compose --profile https up -d --build --scale conteo="$CONTEO" --scale resultados="$RESULTADOS" --scale auth=1

# Firewall básico: solo SSH y web.
if command -v ufw >/dev/null; then ufw allow OpenSSH >/dev/null; ufw allow 80,443/tcp >/dev/null; ufw --force enable >/dev/null; fi

. ./.env
echo
echo "Listo. Abre https://${DOMINIO} (el certificado puede tardar un minuto)."
echo "Estado:    docker compose ps"
echo "Registros: docker compose logs -f conteo"
echo "Respaldo:  bash deploy/respaldo.sh   (hazlo ANTES de borrar el servidor)"
