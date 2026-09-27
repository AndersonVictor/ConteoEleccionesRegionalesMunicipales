# Conteo ERM 2026 — app para personeros

App web para el celular (se instala como app, PWA) que reemplaza los "palitos" en papel del personero durante el escrutinio de las **Elecciones Regionales y Municipales 2026** (4 de octubre de 2026). Cada personero cuenta su mesa, el sistema revisa que el acta **cuadre** y los resultados cerrados se suman en un **dashboard** por región, provincia y distrito.

## Qué hace

- **Registro de personeros** con DNI verificado en RENIEC (ver abajo). El primer usuario que se registra es administrador.
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

## Resultados públicos

El dashboard se puede ver **sin cuenta** en `/#/resultados`. Desde la pantalla de ingreso aparece el botón "Ver resultados en vivo sin cuenta".

- El botón **compartir** genera un enlace al ámbito y la elección que se están viendo (por ejemplo `/#/resultados?u=0401&s=provincial`), listo para WhatsApp o redes.
- No muestra datos personales: solo mesas, organizaciones y votos.
- Lleva el aviso de que son resultados no oficiales.
- Para restringirlo solo a personeros: `DASHBOARD_PUBLICO=0`.
- La respuesta se reutiliza 5 s y se puede cachear en el navegador y en Nginx o una CDN. Por eso aguanta muchos visitantes: con la capacidad medida (≈2 800 consultas/s en 4 núcleos) y la actualización cada 20 s, son unas 50 mil personas mirando a la vez.

## Apariencia

Por defecto la app sigue el modo del celular (claro u oscuro). En **Mi cuenta → Apariencia** se elige Automático, Claro u Oscuro. También hay un botón rápido ◐ en el ingreso y en Resultados.

## Registro de personeros

- Se ingresa con **DNI y contraseña**. El correo es **opcional**: sirve como otra forma de ingresar y queda listo para recuperar la contraseña más adelante.
- Al escribir el DNI, el sistema consulta **RENIEC vía [Decolecta](https://decolecta.com)** y completa nombres y apellidos. Esos campos quedan bloqueados y la cuenta se marca como **verificada**.
- Si el DNI no aparece o la API no responde, el personero escribe sus datos a mano. Se guardan en **MAYÚSCULAS** y la cuenta queda **sin verificar** (el admin lo ve).
- El servidor vuelve a consultar el DNI al registrar, así que no se puede falsear el nombre desde el celular.
- Las consultas se guardan 30 días en la base para no gastar créditos de Decolecta. El token vive solo en el servidor.
- Validaciones (las mismas en el celular y en el servidor, `shared/validacion.js`):
  - DNI de 8 dígitos.
  - Nombres y apellidos solo con letras, en mayúsculas.
  - Celular de 9 dígitos que empieza con 9.
  - Contraseña de 8 caracteres como mínimo, con letras y números, repetida para confirmar.
  - Número de mesa de 6 dígitos y como máximo 300 electores hábiles.
  - Local de votación, organización y observaciones en mayúsculas.

### Activar la consulta de DNI

1. Crea tu token en [decolecta.com](https://decolecta.com).
2. En la carpeta del proyecto: `cp .env.example .env` y edita la línea `DECOLECTA_TOKEN=tu_token`.
3. Prueba el token: `npm run probar:dni -- 12345678`. Debe responder `HTTP 200` con nombres.
4. Reinicia con `npm start`. Al arrancar debe decir `Consulta de DNI (Decolecta): ACTIVADA`.

## Guías de uso

Cada pantalla muestra una guía paso a paso ([driver.js](https://driverjs.com)) la primera vez que se abre: registro, mis mesas, registrar mesa, conteo por cédula (explica las pestañas de las elecciones), conteo por elección, cuadre y resultados. El botón **?** la repite, y en "Mi cuenta" se pueden volver a activar todas.

## Instalación simple (una PC o un servidor pequeño)

Requisitos: **Node.js 22.13 o superior**. Usa SQLite, que viene integrado en Node.

```bash
npm install
cp .env.example .env   # pon tu DECOLECTA_TOKEN
npm start              # http://localhost:3000 (la primera vez carga las organizaciones de data/seed)
```

Registra tu cuenta: el primer usuario es administrador. Para usarlo desde el celular, publícalo con HTTPS. Sin HTTPS no se puede instalar como app ni funciona sin señal.

## Despliegue para alto tráfico (microservicios)

```
                 ┌──────────── Nginx (gateway) ─────────────┐
 celulares ───▶  │ PWA estática  +  reparte /api por ruta    │
                 └───┬──────────────┬───────────────┬───────┘
      /api/auth, /api/dni   /api/actas, mesas...  /api/dashboard
                 ┌───▼───┐    ┌──────▼─────┐    ┌─────▼──────┐
                 │ auth  │    │  conteo    │    │ resultados │   ← N réplicas cada uno
                 │  x2   │    │    x4      │    │     x2     │     (sin estado)
                 └───┬───┘    └──────┬─────┘    └─────┬──────┘
                     └──────── PostgreSQL ────────────┘
                     └──────── Redis (caché y límites) ┘
```

- Una sola imagen de Docker. La variable `SERVICIO` (`auth`, `conteo`, `resultados`) decide qué servicio corre cada contenedor.
- Los servicios no guardan estado: las sesiones son tokens firmados con `SECRET`, la caché y los límites viven en Redis, y los datos en PostgreSQL. Se agregan réplicas sin cambiar código.
- El dashboard no recorre las actas: cada guardado actualiza la tabla `votos_mesa` y el consolidado es una suma SQL. Además, cada ámbito se calcula una vez cada 5 s y se comparte por Redis.
- El celular guarda cada toque localmente y lo envía al servidor como máximo cada 3 s, con un solo envío en curso por acta. Si el servidor se satura, reintenta con una espera aleatoria para que no lleguen todos juntos.

```bash
cp .env.example .env          # SECRET, POSTGRES_PASSWORD, DECOLECTA_TOKEN
docker compose up -d --build  # http://localhost:8080
docker compose up -d --scale conteo=8 --scale resultados=4   # más réplicas el día de la elección
```

Delante hace falta HTTPS: Caddy, Cloudflare o el balanceador de tu proveedor.

### Capacidad medida

Prueba con `npm run carga` en **una sola máquina de 4 núcleos**. En esa máquina corrían a la vez PostgreSQL, Redis, Nginx, 2 réplicas de conteo, auth, resultados y el propio generador de carga. Hubo **1 000 personeros simulados**, con actas de hasta 150 cédulas y **250 conexiones simultáneas**:

| Prueba | Pedidos/s | Latencia p50 | Latencia p99 | Errores |
|---|---|---|---|---|
| Guardar actas | 898 | 291 ms | 582 ms | 0 |
| Dashboard | 2 787 | 81 ms | 180 ms | 0 |
| Mezcla (4 guardados : 1 dashboard) | 1 090 | 52 ms | 670 ms | 0 |

Cómo leer estos números para **50 mil personeros**:

- El límite es el guardado de actas. En el escrutinio se lee una cédula cada 5 a 10 s, y el celular envía como máximo una vez cada 3 s. Un personero genera entre 0,1 y 0,3 guardados por segundo.
- Con ~900 guardados/s, **esta máquina de 4 núcleos atiende unos 3 000 a 4 500 personeros contando a la vez**, sin errores.
- 50 mil personeros contando al mismo tiempo necesitan unos 5 000 a 15 000 guardados/s, es decir entre 6 y 15 veces esta capacidad.
- Eso se logra con PostgreSQL en su propio servidor (8 a 16 vCPU) y 2 o 3 máquinas de 8 a 16 vCPU con réplicas de `conteo` (`--scale conteo=12`), o con servicios administrados.
- **No lo probé a esa escala.** Antes de la elección hay que correr `npm run carga` contra la infraestructura real.

## Seguridad

Lo que ya está:

- Contraseñas con scrypt y sesiones firmadas (HMAC).
- Consultas SQL parametrizadas.
- Todo texto se escapa al mostrarse (sin inyección de HTML).
- Política CSP estricta (solo se ejecuta código propio) y cabeceras anti-clickjacking.
- Límites de intentos por IP.
- Validaciones repetidas en el servidor: DNI, nombres, mesa única, tope de electores, cuadre y observación.
- Cada personero solo ve y edita sus actas.
- El token de Decolecta nunca llega al celular.

Pendiente o a cuidar al publicar:

- **HTTPS obligatorio**, y activar HSTS en `deploy/nginx.conf`.
- **Definir `ADMIN_DNIS`**. Sin esa variable, el primer usuario que se registra queda como administrador.
- Las sesiones duran 30 días y todavía no se pueden cerrar a distancia. Tampoco hay recuperación de contraseña.
- Respaldos automáticos de PostgreSQL.
- Monitoreo durante la jornada electoral.

## Variables de entorno

Ver `.env.example`. Las principales:

| Variable | Por defecto | Descripción |
|---|---|---|
| `DECOLECTA_TOKEN` | — | Token de Decolecta para autocompletar nombres por DNI |
| `SECRET` | se genera en `data/secret.key` | Clave de las sesiones (obligatoria con microservicios) |
| `DATABASE_URL` | — (SQLite) | `postgres://...` para PostgreSQL |
| `REDIS_URL` | — (memoria) | `redis://...` para caché compartida entre réplicas |
| `SERVICIO` | — (todo en uno) | `auth`, `conteo` o `resultados` |
| `ADMIN_DNIS` | — | DNIs que se registran como administradores |
| `LIMITE_LOGIN` / `LIMITE_DNI` | `100` / `60` | Intentos por IP cada 10 min (holgados por el CGNAT de las redes móviles) |
| `DASHBOARD_CACHE_SEG` | `5` | Segundos que se reutiliza un consolidado |
| `DASHBOARD_PUBLICO` | `1` | `0` exige iniciar sesión para ver resultados |
| `JNE_AUTO` | `1` | `0` desactiva la consulta automática al JNE |
| `PORT`, `DB_PATH`, `PG_POOL_MAX` | `3000`, `data/conteo.db`, `20` | Puerto, archivo SQLite y conexiones a Postgres por réplica |

## Estructura

```
server/
  index.js            arranque (todo en uno o un solo servicio con SERVICIO=...)
  app.js              arma la app con los servicios elegidos
  services/auth.js    registro, ingreso, DNI (Decolecta), administración de personeros
  services/conteo.js  ubigeo, organizaciones, mesas y actas
  services/resultados.js  dashboard
  lib/db.js           SQLite o PostgreSQL con la misma interfaz
  lib/cache.js        caché y límites en memoria o Redis
  lib/consolidado.js  votos por mesa listos para sumar
  lib/resultados.js   cálculo del dashboard
  lib/organizaciones.js  catálogo y cliente del JNE
  lib/decolecta.js    consulta de DNI
shared/               reglas del acta y validaciones (servidor y navegador)
public/               PWA sin compilación (+ driver.js en public/vendor)
deploy/nginx.conf     gateway
docker-compose.yml    despliegue completo
scripts/carga.js      prueba de carga
test/                 pruebas (npm test; con TEST_DATABASE_URL también contra PostgreSQL)
```

## Aviso

Es una herramienta de apoyo para personeros. El resultado oficial es el que consta en las actas electorales y el que publica la ONPE.
