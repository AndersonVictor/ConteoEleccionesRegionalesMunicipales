#!/usr/bin/env bash
# Copia de la base de datos a un archivo. Descárgalo a tu PC con:
#   scp root@IP_DEL_SERVIDOR:/opt/conteo/respaldos/<archivo> .
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p respaldos
FECHA=$(date +%Y%m%d-%H%M)
if command -v docker >/dev/null && docker compose ps --services --status running 2>/dev/null | grep -q postgres; then
  ARCHIVO="respaldos/conteo-$FECHA.sql.gz"
  docker compose exec -T postgres pg_dump -U conteo conteo | gzip > "$ARCHIVO"
else
  # Modo liviano (SQLite): copia consistente aunque la app esté funcionando.
  ARCHIVO="respaldos/conteo-$FECHA.db"
  node --disable-warning=ExperimentalWarning -e "new (require('node:sqlite').DatabaseSync)('data/conteo.db').exec(\"VACUUM INTO '$ARCHIVO'\")"
fi
echo "Respaldo guardado en $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"
