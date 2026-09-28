#!/usr/bin/env bash
# Copia de la base de datos (y los resultados) a un archivo. Descárgalo a tu PC con:
#   scp root@IP_DEL_SERVIDOR:/opt/conteo/respaldos/<archivo> .
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p respaldos
ARCHIVO="respaldos/conteo-$(date +%Y%m%d-%H%M).sql.gz"
docker compose exec -T postgres pg_dump -U conteo conteo | gzip > "$ARCHIVO"
echo "Respaldo guardado en $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
