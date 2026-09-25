import { defineConfig } from 'vitest/config'
import dotenv from 'dotenv'

dotenv.config()

const TEST_DB_NAME = `${process.env.DB_NAME || 'hocico_pet_shop'}_test`

export default defineConfig({
  test: {
    environment: 'node',

    // NOTA (Windows): Vitest+Vite deja FILEHANDLEs abiertos al cerrar y la
    // corrida tarda ~10 s extra en terminar. Es infraestructura, no el pool
    // de MySQL (verificar con `npx vitest run tests/unit`, que no toca la BD
    // y aun así lo reproduce). No afecta al resultado, sí a la velocidad.

    // Prepara la BD de test una vez por corrida: la crea, migra y siembra.
    globalSetup: './tests/setup/globalSetup.js',

    // Cierra el pool de MySQL al terminar cada archivo, o el proceso no acaba.
    setupFiles: ['./tests/setup/closePool.js'],

    // Todos los archivos comparten UNA base de test y la truncan entre suites.
    // Ejecutarlos en paralelo produciría interferencia cruzada (datos de un
    // test apareciendo en otro). Secuencial a cambio de velocidad.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 60000,

    // Sobrescrito en los workers; dotenv NO pisa variables ya presentes.
    env: {
      NODE_ENV: 'test',
      DB_NAME: TEST_DB_NAME,
      RATE_LIMIT_MAX: '1000000',
      RATE_LIMIT_WINDOW_MS: '60000',
      JWT_SECRET: 'jwt-de-pruebas-no-usar-en-produccion',

      // paymentController lee la configuración de Wompi al importarse, así
      // que necesita estar en el entorno ANTES de cargar la app.
      WOMPI_PUBLIC_KEY: 'pub_test_123',
      WOMPI_INTEGRITY_SECRET: 'integ_test_123',
      WOMPI_EVENTS_SECRET: 'events_test_123',
      WOMPI_ENV: 'sandbox',
      FRONTEND_URL: 'http://localhost:5173',
    },

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.js'],
      exclude: ['src/index.js', 'src/seeders/**'],
      // Ratchet, no objetivo: los valores actuales son 35.09 líneas,
      // 58.57 ramas, 36.05 funciones. El umbral va un par de puntos por debajo
      // para que la CI detecte que la cobertura BAJA, sin bloquear el día a
      // día. Subirlo a medida que entren las suites de POS, stock, carrito,
      // facturación y autenticación.
      thresholds: {
        lines: 33,
        functions: 34,
        statements: 33,
        branches: 55,
      },
    },
  },
})
