# Conteo ERM 2026 — app para personeros

App web para el celular (se instala como app, PWA) que reemplaza los "palitos" en papel del personero durante el escrutinio de las **Elecciones Regionales y Municipales 2026** (4 de octubre de 2026). Cada personero cuenta su mesa, el sistema revisa que el acta **cuadre** y los resultados cerrados se suman en un **dashboard** por región, provincia y distrito.

## Qué hace

- **Registro de personeros**: nombre, DNI, celular, correo y organización que representa. El primer usuario que se registra es administrador.
- **Registro de mesa**: número de mesa (6 dígitos), departamento/provincia/distrito, local y electores hábiles. Varios personeros pueden registrar la misma mesa y cada uno lleva su propio conteo.
- **La cédula según el distrito**:
  - Distrito normal: 4 elecciones (Gobernador regional, Consejeros regionales, Alcalde provincial, Alcalde distrital).
  - Distrito capital de provincia (código `..01`): 3 elecciones, sin alcalde distrital.
  - Lima Metropolitana: no hay gobierno regional, solo alcalde metropolitano y distrital.
- **Dos formas de contar**:
  - **Por cédula** (recomendada): por cada cédula que lee el presidente de mesa marcas una opción en cada elección y tocas "Registrar cédula". Así cada cédula suma exactamente 1 voto en cada elección y el acta cuadra sola. Si el voto es para la misma organización en todas, un botón la marca en las demás.
  - **Por elección**: botones grandes de **+1 / −1** por organización, igual que los palitos en papel (también se dibujan palitos agrupados de 5).
  - En todas las elecciones hay además **blanco, nulo e impugnado**.
- **Cuadre**: al final ingresas el total de ciudadanos que votaron (de la lista de electores). El sistema revisa que:
  - ese total no sea mayor que los electores hábiles,
  - cada elección sume exactamente ese total, y te dice cuántos votos sobran o faltan.
  - Solo se puede cerrar un acta que cuadra; si no cuadra, se puede cerrar con una observación escrita.
- **Deshacer e historial**: deshacer el último registro o borrar cualquiera desde el historial.
- **Funciona sin señal**: cada toque se guarda primero en el celular y se envía al servidor cuando vuelve la conexión.
- **Compartir** el resultado de la mesa por WhatsApp o copiar el texto.
- **Dashboard de resultados** (se actualiza cada 20 s):
  - quién va ganando en la región, provincia o distrito, con porcentajes sobre votos válidos,
  - desglose de "quién va ganando" en cada provincia o distrito,
  - estado de cada mesa,
  - **mesas con diferencias** cuando dos personeros cerraron la misma mesa con números distintos.
  - Por defecto solo suma actas cerradas; se pueden incluir los conteos en curso.
- **Administración**: organizaciones por circunscripción (sincronizar con el JNE, agregar a mano, cambiar el orden de la cédula), lista de actas y personeros, y asignar administradores.

## ¿Hay una API con los partidos de cada provincia y distrito?

No hay una API oficial documentada, pero la plataforma **Voto Informado del JNE** usa un endpoint público que funciona sin sesión y que este sistema consume:

```
POST https://votoinformado.jne.gob.pe/api/v1/candidatos/organizaciones
Content-Type: application/json

{ "dep": "04", "pro": "01", "dis": "09" }
```

- Responde con las organizaciones agrupadas por tipo de elección: `4` = regional (con `tieneGobernadores` / `tieneConsejeros`), `5` = municipal provincial, `6` = municipal distrital.
- **Ojo:** usa códigos de ubigeo **RENIEC**, no INEI (por ejemplo Paucarpata es `040112` en INEI y `040109` en RENIEC). `data/ubigeo.json` guarda los dos códigos para los 1893 distritos, así que la conversión es automática.
- Los logos están en `https://stovotoinformadodev.blob.core.windows.net/contenedor-2/<id>.png`.

Cómo lo usa el sistema:
1. La primera vez que alguien abre una mesa de un distrito, el servidor consulta al JNE y guarda las organizaciones en la base de datos. Se refrescan cada 24 h.
2. Si el JNE no responde, se usa lo que ya está en la base: la semilla incluida o sincronizaciones anteriores. Si no hay nada, el personero o el admin agrega las organizaciones a mano, tal como aparecen en la cédula.
3. Se incluye una semilla con las organizaciones reales de **Arequipa**, obtenidas de esa misma API en septiembre de 2026: región, 8 provincias y 101 distritos. Contiene solo nombres y logos, sin datos de candidatos.

Como es un endpoint no documentado, el JNE puede cambiarlo sin aviso. Conviene precargar tu región antes del día de la elección:

```bash
npm run sync:jne -- 04       # todo Arequipa (ubigeo INEI del departamento)
npm run sync:jne -- 0401     # una provincia
npm run sync:jne -- 040112   # un distrito
```

## Instalación

Requisitos: **Node.js 22.13 o superior**. La base de datos es SQLite integrado en Node, así que no hay que instalar nada más.

```bash
npm install
npm run seed        # carga las organizaciones de data/seed (Arequipa)
npm start           # http://localhost:3000
```

Registra tu cuenta: el primer usuario es administrador. Para usarlo desde el celular, publícalo en un servidor con HTTPS (Railway, Render, un VPS con Caddy o Nginx, etc.). HTTPS hace falta para que la app se pueda instalar y funcione sin conexión.

### Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `DB_PATH` | `data/conteo.db` | Archivo SQLite |
| `SECRET` | se genera en `data/secret.key` | Clave para firmar las sesiones |
| `ADMIN_EMAILS` | — | Correos separados por coma que se registran como admin |
| `JNE_AUTO` | `1` | `0` desactiva la consulta automática al JNE |
| `JNE_REFRESCO_HORAS` | `24` | Cada cuánto se vuelve a consultar al JNE |
| `JNE_TIMEOUT_MS` | `10000` | Tiempo máximo de espera al JNE |

## Estructura

```
server/          API Express + SQLite (node:sqlite)
  app.js         rutas: auth, mesas/actas, organizaciones, dashboard, admin
  organizaciones.js  catálogo por circunscripción + cliente del JNE
  dashboard.js   consolidado (una acta por mesa, detección de diferencias)
shared/acta.js   reglas del acta (secciones por distrito, conteo, cuadre); la usan servidor y navegador
public/          PWA sin compilación (HTML + CSS + módulos JS)
data/ubigeo.json 25 departamentos, 196 provincias, 1893 distritos (INEI + RENIEC)
data/seed/       organizaciones precargadas
scripts/         seed, sync con JNE, generación de ubigeo
test/            pruebas (npm test)
```

## Aviso

Es una herramienta de apoyo para personeros. El resultado oficial es el que consta en las actas electorales y el que publica la ONPE.
