import jwt from 'jsonwebtoken'
import { queryOne } from '../config/database.js'

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'

export async function authenticate(req, res, next) {
  try {
    const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '')

    if (!token) {
      return res.status(401).json({ error: 'Token de autenticación requerido' })
    }

    let decoded
    try {
      decoded = jwt.verify(token, JWT_SECRET)
    } catch (err) {
      return res.status(401).json({ error: 'Token inválido o expirado' })
    }

    const user = await queryOne(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.address, u.city, u.province, u.avatar_url, u.is_active, r.name as role, r.permissions
       FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
      [decoded.id]
    )

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Usuario no encontrado o desactivado' })
    }

    let permissions = null
    try {
      permissions = typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions
    } catch {
      permissions = null
    }

    req.user = {
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
      permissions,
    }

    next()
  } catch (error) {
    console.error('Auth middleware error:', error)
    res.status(500).json({ error: 'Error de autenticación' })
  }
}

export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' })
    }

    if (allowedRoles.includes(req.user.role)) {
      return next()
    }

    return res.status(403).json({ error: 'No tienes permisos para esta acción' })
  }
}

export function requirePermission(module, action) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autenticado' })
    }

    if (req.user.role === 'admin') {
      return next()
    }

    const perms = req.user.permissions
    if (!perms) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción' })
    }

    const modulePerms = perms[module]
    const hasAction = Array.isArray(modulePerms) && modulePerms.includes(action)

    if (!hasAction) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción' })
    }

    next()
  }
}

export function optionalAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '')

  if (!token) {
    return next()
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    req.user = decoded
  } catch (err) {
    // Token invalid, continue as guest
  }

  next()
}