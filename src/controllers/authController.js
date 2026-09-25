import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { query, queryOne, transaction } from '../config/database.js'
import { validationResult } from 'express-validator'
import { generateOrderNumber } from '../utils/helpers.js'

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
const JWT_EXPIRES_IN = '7d'
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  )
}

function setTokenCookie(res, token) {
  res.cookie('token', token, COOKIE_OPTIONS)
}

function clearTokenCookie(res) {
  res.clearCookie('token', COOKIE_OPTIONS)
}

export async function register(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { firstName, lastName, email, password, phone } = req.body

  try {
    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email])
    if (existing) {
      return res.status(409).json({ error: 'El email ya está registrado' })
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const result = await query(
      `INSERT INTO users (first_name, last_name, email, password_hash, phone, role_id)
       VALUES (?, ?, ?, ?, ?, 2)`,
      [firstName, lastName, email, passwordHash, phone || null]
    )

    const user = await queryOne(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.address, u.city, u.province, u.avatar_url, u.is_active, r.name as role
       FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
      [result.insertId]
    )

    const token = generateToken(user)
    setTokenCookie(res, token)

    res.status(201).json({
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        city: user.city,
        province: user.province,
        avatarUrl: user.avatar_url,
        role: user.role,
      },
      token,
    })
  } catch (error) {
    console.error('Register error:', error)
    res.status(500).json({ error: 'Error al registrar usuario' })
  }
}

export async function login(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { email, password } = req.body

  try {
    const user = await queryOne(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.password_hash, u.phone, u.address, u.city, u.province, u.avatar_url, u.is_active, r.name as role
       FROM users u JOIN roles r ON u.role_id = r.id WHERE u.email = ?`,
      [email]
    )

    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' })
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'Cuenta desactivada' })
    }

    const validPassword = await bcrypt.compare(password, user.password_hash)
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciales inválidas' })
    }

    await query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id])

    const token = generateToken(user)
    setTokenCookie(res, token)

    res.json({
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        city: user.city,
        province: user.province,
        avatarUrl: user.avatar_url,
        role: user.role,
      },
      token,
    })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Error al iniciar sesión' })
  }
}

export async function logout(req, res) {
  clearTokenCookie(res)
  res.json({ message: 'Sesión cerrada correctamente' })
}

export async function getMe(req, res) {
  try {
    const user = await queryOne(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.address, u.city, u.province, u.avatar_url, u.is_active, r.name as role
       FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
      [req.user.id]
    )

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    res.json({
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        city: user.city,
        province: user.province,
        avatarUrl: user.avatar_url,
        role: user.role,
      },
    })
  } catch (error) {
    console.error('Get me error:', error)
    res.status(500).json({ error: 'Error al obtener usuario' })
  }
}

export async function updateProfile(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { firstName, lastName, phone, address, city, province } = req.body

  try {
    await query(
      `UPDATE users SET first_name = ?, last_name = ?, phone = ?, address = ?, city = ?, province = ?
       WHERE id = ?`,
      [firstName, lastName, phone, address, city, province, req.user.id]
    )

    const user = await queryOne(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.address, u.city, u.province, u.avatar_url, u.is_active, r.name as role
       FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
      [req.user.id]
    )

    res.json({
      user: {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        phone: user.phone,
        address: user.address,
        city: user.city,
        province: user.province,
        avatarUrl: user.avatar_url,
        role: user.role,
      },
    })
  } catch (error) {
    console.error('Update profile error:', error)
    res.status(500).json({ error: 'Error al actualizar perfil' })
  }
}

export async function changePassword(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { currentPassword, newPassword } = req.body

  try {
    const user = await queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id])
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    const validPassword = await bcrypt.compare(currentPassword, user.password_hash)
    if (!validPassword) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' })
    }

    const newHash = await bcrypt.hash(newPassword, 12)
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id])

    res.json({ message: 'Contraseña actualizada correctamente' })
  } catch (error) {
    console.error('Change password error:', error)
    res.status(500).json({ error: 'Error al cambiar contraseña' })
  }
}

export async function forgotPassword(req, res) {
  // TODO: Implement email sending with reset token
  res.json({ message: 'Si el email existe, recibirás instrucciones para restablecer tu contraseña' })
}

export async function resetPassword(req, res) {
  // TODO: Implement password reset with token validation
  res.json({ message: 'Contraseña restablecida correctamente' })
}