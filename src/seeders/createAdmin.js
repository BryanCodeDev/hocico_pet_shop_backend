import bcrypt from 'bcryptjs'
import { query, queryOne, transaction } from '../config/database.js'

async function createAdmin() {
  const email = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  const firstName = process.env.ADMIN_FIRST_NAME
  const lastName = process.env.ADMIN_LAST_NAME

  if (!email || !password) {
    console.error('❌ ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required')
    process.exit(1)
  }

  try {
    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email])
    if (existing) {
      console.log('⚠️  Admin user already exists')
      return
    }

    const passwordHash = await bcrypt.hash(password, 12)

    await transaction(async (conn) => {
      await conn.execute(
        `INSERT INTO users (first_name, last_name, email, password_hash, role_id, is_active, email_verified)
         VALUES (?, ?, ?, ?, 1, TRUE, TRUE)`,
        [firstName || 'Admin', lastName || 'TechStore', email, passwordHash]
      )
    })

    console.log('✅ Admin user created successfully')
    console.log(`   Email: ${email}`)
  } catch (error) {
    console.error('❌ Error creating admin:', error.message)
    throw error
  }
}

createAdmin().then(() => process.exit(0)).catch(() => process.exit(1))