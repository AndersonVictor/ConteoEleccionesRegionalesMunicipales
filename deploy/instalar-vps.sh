#!/usr/bin/env bash
# Instala la app completa en un VPS nuevo con Ubuntu 22.04/24.04 (como root):
#   curl -fsSL https://raw.githubusercontent.com/AndersonVictor/ConteoEleccionesRegionalesMunicipales/main/deploy/instalar-vps.sh | bash
# También se puede pegar como "user data / cloud-init" al crear el servidor (definiendo antes
# DOMINIO, DECOLECTA_TOKEN y ADMIN_DNIS al inicio del script).
set -euo pipefail

REPO="${REPO:-https://github.com/AndersonVictor/ConteoEleccionesRegionalesMunicipales.git}"
RAMA="${RAMA:-main}"
DIR=/opt/conteo

echo "==> Instalando Docker"
if ! command -v docker >/dev/null; then
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
