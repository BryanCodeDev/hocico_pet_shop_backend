import 'dotenv/config'
import app from './app.js'
import { connectDB, ensureDatabase } from './config/database.js'
import { runMigrations, runSeed } from './utils/migrate.js'

const PORT = process.env.PORT || 3001

async function start() {
  try {
    await ensureDatabase()
    await runMigrations()
    await runSeed()
    await connectDB()
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`)
      console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

start()
