# Hocico Pet Shop — Backend

API REST de Hocico Pet Shop: catálogo, pedidos, inventario, pagos, facturación electrónica y punto de venta (POS). Es la fuente de verdad del negocio; el frontend es un cliente de esta API.

---

## ¿Qué es este servicio?

Un API Express + MySQL que opera bajo **dos canales de venta**:

- **Tienda online**: el cliente navega, arma un carrito y paga vía Wompi.
- **Punto de venta (POS)**: el cajero registra ventas en la tienda física, en efectivo o con tarjeta.

**Partes principales:**

1. **API pública**: catálogo, categorías, carrito, checkout y pagos.
2. **Panel de administración**: productos, categorías, pedidos, usuarios y configuración.
3. **Módulo POS**: caja, búsqueda por código de barras, cobro y recibos.

---

## Requisitos

- **Node.js 20** (la CI usa esa versión; el proyecto es ESM, `"type": "module"`).
- **MySQL 8.0** accesible. En local se usa el puerto **3307**.
- Una base de datos MySQL vacía es suficiente: el arranque crea el esquema.

---

## Puesta en marcha

```bash
npm install
cp .env.example .env      # y rellena los valores
npm run dev               # http://localhost:3001
```

**No hay que migrar a mano.** `src/index.js` hace todo en cada arranque, en este orden:

1. `ensureDatabase()` — crea la base si no existe.
2. `runMigrations()` — aplica las migraciones pendientes.
3. `runSeed()` — carga `seed.sql`.
4. `connectDB()` — abre el pool.
5. `app.listen(PORT)`.

Los pasos son **idempotentes**: una migración que ya se aplicó se salta, y el seed usa `INSERT IGNORE`. Por eso se puede arrancar tantas veces como quieras sin romper nada.

Si solo quieres correr las migraciones sin levantar el servidor:

```bash
npm run db:migrate
```

### Verificar que vive

```bash
curl http://localhost:3001/api/health
# {"status":"ok","timestamp":"2026-..."}
```

---

## Estructura del proyecto

```
backend/
├── src/
│   ├── index.js              Arranque: migra, siembra y escucha
│   ├── app.js                Configuración de Express y montaje de rutas
│   ├── config/               Conexión MySQL y cliente de Cloudinary
│   ├── controllers/          Lógica de negocio (13 controladores)
│   ├── routes/               Definición de endpoints (12 archivos)
│   ├── middleware/           auth, errorHandler, notFound
│   ├── seeders/              Creación del usuario administrador
│   ├── utils/                migrate, factusService, helpers
│   └── validations/          Reglas de validación con express-validator
├── tests/
│   ├── unit/                 Pruebas puras, sin base de datos
│   ├── integration/          Pruebas HTTP contra la app completa
│   ├── setup/                globalSetup y cierre del pool
│   └── helpers/             Factories y utilidades de base de datos
├── schema.sql                Esquema completo de referencia
├── seed.sql                  Datos iniciales
├── vitest.config.js          Configuración de pruebas
├── railway.json              Despliegue en Railway
└── .env.example              Plantilla de variables
```

**La separación entre `app.js` e `index.js` es deliberada**: `app.js` exporta la app sin escuchar en el puerto, lo que permite que las pruebas la monten con `supertest` sin abrir un socket real.

---

## Configuración

Las variables se leen desde `.env` con `dotenv`. Este archivo **no se versiona**; en producción se configuran en el panel del proveedor.

| Grupo | Variables | Para qué |
|---|---|---|
| Servidor | `PORT`, `NODE_ENV` | Puerto y comportamiento de errores |
| Base de datos | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Conexión a MySQL |
| Sesión | `JWT_SECRET` | Firma de los tokens. **Mínimo 32 caracteres** |
| Pagos | `WOMPI_ENV`, `WOMPI_PUBLIC_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET` | Checkout y webhooks |
| Facturación | `FACTUS_*` | Emisión de facturas electrónicas |
| Imágenes | `CLOUDINARY_*` | Subida de fotos de producto |
| Seguridad | `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | Límite de peticiones por IP |
| Seed | `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_FIRST_NAME`, `ADMIN_LAST_NAME` | Usuario admin inicial |

`NODE_ENV=development` expone el stack de errores en las respuestas; `production` lo oculta. No hay variable para el correo: `nodemailer` está instalado pero el envío **no está implementado**.

---

## Base de datos

- **Migraciones**: 36 pasos numerados dentro de `src/utils/migrate.js`. Cada uno corre una sola vez y se registra; las que ya se aplicaron se saltan.
- **`schema.sql`**: el esquema completo, útil como referencia para leer las tablas de un tirón.
- **`seed.sql`**: datos iniciales (roles, usuarios de ejemplo, categorías, marcas, zonas de envío y productos de demostración). Se ejecuta en cada arranque.

**Ojo con el seed**: inserta productos y categorías de ejemplo en la base de desarrollo. Si quieres empezar con el catálogo vacío, quita esas sentencias de `seed.sql` y limpia las filas existentes.

---

## API

Todo cuelga de `/api`. Las rutas protegidas devuelven **401** sin sesión y **403** con un rol insuficiente.

| Prefijo | Responsabilidad |
|---|---|
| `/api/health` | Sonda de vida |
| `/api/auth` | Registro, login, sesión |
| `/api/products` | Catálogo público, búsqueda, destacados |
| `/api/categories` | Jerarquía de categorías |
| `/api/orders` | Creación y seguimiento de pedidos |
| `/api/cart` | Carrito de invitados y usuarios |
| `/api/payments` | Checkout de Wompi, webhooks, estado |
| `/api/users` | Gestión de usuarios (legado) |
| `/api/admin` | Panel de administración |
| `/api/shipping-zones` | Zonas de envío y costos |
| `/api/admin/invoices` | Facturas electrónicas |
| `/api/admin/stock` | Movimientos de inventario |
| `/api/pos` | Caja, ventas y recibos |

### Decisiones que conviene conocer

**CORS reflectivo.** `origin: true` con `credentials: true` devuelve como origen permitido el que manda la petición. Funciona en cualquier dominio, pero en producción conviene restringirlo a los orígenes reales.

**Límite de peticiones.** Se aplica a todo `/api/` con 100 peticiones por IP cada 15 minutos por defecto.

**Límite de cuerpo.** 10 MB, suficiente para las descripciones largas de producto y los cuerpos HTML del POS.

---

## Autenticación y autorización

- `JWT_SECRET` firma los tokens; `auth.js` valida el token **y** comprueba que el usuario siga activo, de modo que desactivar a alguien invalida su sesión de inmediato.
- Los roles son `admin`, `user`, `cashier` y `manager`.
- Las superficies `/api/users` y `/api/admin/users` están en paridad: exigen los mismos permisos.

---

## Pagos

El checkout usa **Wompi**, no Mercado Pago. El flujo online:

1. El cliente confirma el carrito y se crea la orden.
2. El backend genera la firma de integridad y devuelve la clave pública y el ambiente.
3. El navegador abre el checkout de Wompi.
4. Wompi notifica a `POST /api/payments/webhook`, que valida la firma de los eventos.
5. Al aprobarse, la orden pasa a `paid` y se dispara la factura.

**Idempotencia**: un evento repetido no vuelve a descontar stock. Si la pasarela reintenta, la orden no se altera.

**Facturación (Factus)**: al confirmarse el pago se llama a `triggerInvoiceGeneration(orderId)`. Si la facturación falla, el error queda en `invoices.status='error'` y **la venta no se cancela**.

Las claves de Wompi se leen al importar el módulo de pagos, por eso deben existir en el entorno antes de cargar la app.

---

## Pruebas

```bash
npm test                # suite completa
npm run test:unit       # solo unitarias, sin base de datos
npm run test:integration
npm run test:coverage   # con umbral de cobertura
npm run test:watch
```

Estado actual: **166 pruebas en 7 archivos**, todas en verde.

**Cómo funcionan:**

- **Base de datos propia**: `globalSetup` crea `<DB_NAME>_test` — sobre `hocico_pet_shop_test` —, la migra y la siembra. Tus datos de desarrollo no se tocan.
- **Ejecución secuencial** (`fileParallelism: false`): los archivos comparten una sola base y la truncan entre suites; en paralelo habría interferencia cruzada.
- **Cierre del pool**: sin `closePool.js` el proceso de Vitest no termina.
- **Entorno aislado**: `vitest.config.js` sobrescribe `NODE_ENV`, `DB_NAME`, `JWT_SECRET`, el rate limit y las claves de Wompi. No hace falta una `.env.test`.
- **Sin red**: la suite es real contra la app completa vía `supertest`, con MySQL real y no emulado. Se validan InnoDB y las claves foráneas de verdad.

**Cobertura**: los umbrales en `vitest.config.js` son un *ratchet*, no un objetivo. Van un par de puntos por debajo de la cobertura real para que la CI detecte que **baja**, sin bloquear el día a día. Suben a medida que entren suites nuevas.

---

## Integración continua

La definición está en `.github/workflows/ci.yml`, en la **raíz del repositorio** (cubre ambos proyectos).

- Levanta MySQL 8.0 como servicio, mapeado al puerto 3307.
- Backend: `npm test` y `npm run test:coverage`.
- Frontend: `npm run lint`, `npm test` y `npm run build`.
- Las credenciales llegan por variables de entorno del runner: el `.env` local nunca se sube.

---

## Despliegue

**Direcciones de producción:**

| Servicio | URL |
|---|---|
| Backend | `https://hocicopetshopbackend-production.up.railway.app` |
| Frontend | `https://hocico-pet-shop.netlify.app` |
| Sonda de salud | `https://hocicopetshopbackend-production.up.railway.app/api/health` |

`railway.json` define el arranque y la sonda de salud:

```json
"startCommand": "npm start",
"healthcheckPath": "/api/health"
```

Las migraciones y el seed se ejecutan solos en cada arranque, así que un despliegue nuevo no necesita pasos manuales. Las variables se configuran en el panel de Railway, no en un archivo.

**En Railway hay que definir `FRONTEND_URL`** con la URL del frontend desplegado, porque de ahí se construyen los redirects de regreso tras el pago. Si se queda apuntando a `localhost`, el cliente vuelve al servidor de su propia máquina después de pagar.

---

## Problemas frecuentes

**P: El arranque falla con `EADDRINUSE`.**
R: Hay otra instancia en el puerto 3001. Ciérrala o cambia `PORT`.

**P: `Access denied for user`.**
R: Las credenciales de `.env` no coinciden con tu MySQL. El puerto 3307 es el mapeo del contenedor, no el 3306 por defecto.

**P: Las pruebas fallan con errores de conexión.**
R: MySQL debe estar arriba antes de `npm test`; es la única dependencia externa de la suite.

**P: El seed no inserta lo que espero.**
R: Usa `INSERT IGNORE`, así que las filas que ya existen se saltan en silencio. Para recargar el seed hay que borrar las filas antes.

**P: Los errores no muestran el stack.**
R: `NODE_ENV` está en `production`. En local debe ser `development`.

**P: ¿Por qué los datos vienen como texto?**
R: `mysql2` devuelve los `DECIMAL` como string. Toda comparación o suma monetaria necesita `Number()` alrededor.
