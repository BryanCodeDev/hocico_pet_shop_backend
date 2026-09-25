import { query, queryOne } from '../config/database.js'
import bcrypt from 'bcryptjs'
import { validationResult } from 'express-validator'

export async function getUsers(req, res) {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = Math.min(parseInt(req.query.limit) || 20, 100)
    const search = req.query.search
    const role = req.query.role
    const status = req.query.status
    const offset = (page - 1) * limit

    let sql = `
      SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.address, u.city, u.province,
             u.avatar_url, u.is_active, u.email_verified, u.last_login, u.created_at,
             r.name as role
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE u.deleted_at IS NULL
    `
    const params = []

    if (search) {
      sql += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)'
      const term = `%${search}%`
      params.push(term, term, term, term)
    }
    if (role) {
      sql += ' AND r.name = ?'
      params.push(role)
    }
    if (status === 'active') {
      sql += ' AND u.is_active = TRUE'
    } else if (status === 'inactive') {
      sql += ' AND u.is_active = FALSE'
    }

    sql += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const countSql = sql.replace(
      'SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.address, u.city, u.province, u.avatar_url, u.is_active, u.email_verified, u.last_login, u.created_at, r.name as role',
      'SELECT COUNT(*) as total'
    ).replace(/ORDER BY.*$/, '').replace(/LIMIT.*$/, '')

    const [users, countResult] = await Promise.all([
      query(sql, params),
      queryOne(countSql, params.slice(0, -2)),
    ])

    res.json({
      users: users.map(u => ({
        id: u.id,
        firstName: u.first_name,
        lastName: u.last_name,
        email: u.email,
        phone: u.phone,
        address: u.address,
        city: u.city,
        province: u.province,
        avatarUrl: u.avatar_url,
        isActive: u.is_active,
        emailVerified: u.email_verified,
        lastLogin: u.last_login,
        createdAt: u.created_at,
        role: u.role,
      })),
      pagination: {
        page,
        limit,
        total: countResult?.total || 0,
        totalPages: Math.ceil((countResult?.total || 0) / limit),
      },
    })
  } catch (error) {
    console.error('Get users error:', error)
    res.status(500).json({ error: 'Error al obtener usuarios' })
  }
}

export async function getUserById(req, res) {
  try {
    const { id } = req.params

    if (req.user.role !== 'admin' && req.user.id !== parseInt(id)) {
      return res.status(403).json({ error: 'No tienes permisos para ver este usuario' })
    }

    const user = await queryOne(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.address, u.city, u.province,
              u.avatar_url, u.is_active, u.email_verified, u.last_login, u.created_at,
              r.name as role
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = ? AND u.deleted_at IS NULL`,
      [id]
    )

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    const orderCount = await queryOne('SELECT COUNT(*) as count FROM orders WHERE user_id = ?', [id])
    const totalSpent = await queryOne('SELECT SUM(total) as total FROM orders WHERE user_id = ? AND payment_status = "approved"', [id])

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
        isActive: user.is_active,
        emailVerified: user.email_verified,
        lastLogin: user.last_login,
        createdAt: user.created_at,
        role: user.role,
        orderCount: orderCount?.count || 0,
        totalSpent: totalSpent?.total || 0,
      },
    })
  } catch (error) {
    console.error('Get user error:', error)
    res.status(500).json({ error: 'Error al obtener usuario' })
  }
}

export async function updateUser(req, res) {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  try {
    const { id } = req.params
    const { firstName, lastName, phone, address, city, province, email } = req.body

    if (req.user.role !== 'admin' && req.user.id !== parseInt(id)) {
      return res.status(403).json({ error: 'No tienes permisos para actualizar este usuario' })
    }

    if (email) {
      const existing = await queryOne('SELECT id FROM users WHERE email = ? AND id != ?', [email, id])
      if (existing) {
        return res.status(409).json({ error: 'El email ya está en uso' })
      }
    }

    await query(
      `UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ?, address = ?, city = ?, province = ?
       WHERE id = ?`,
      [firstName, lastName, email, phone, address, city, province, id]
    )

    const user = await queryOne(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.address, u.city, u.province,
              u.avatar_url, u.is_active, u.email_verified, u.last_login, u.created_at,
              r.name as role
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = ?`,
      [id]
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
        isActive: user.is_active,
        emailVerified: user.email_verified,
        lastLogin: user.last_login,
        createdAt: user.created_at,
        role: user.role,
      },
    })
  } catch (error) {
    console.error('Update user error:', error)
    res.status(500).json({ error: 'Error al actualizar usuario' })
  }
}

export async function toggleUserStatus(req, res) {
  try {
    const { id } = req.params

    if (req.user.id === parseInt(id)) {
      return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' })
    }

    const user = await queryOne('SELECT is_active FROM users WHERE id = ? AND deleted_at IS NULL', [id])
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    await query('UPDATE users SET is_active = ? WHERE id = ?', [!user.is_active, id])
    res.json({ message: `Usuario ${!user.is_active ? 'activado' : 'desactivado'}` })
  } catch (error) {
    console.error('Toggle user status error:', error)
    res.status(500).json({ error: 'Error al cambiar estado' })
  }
}

export async function changeUserRole(req, res) {
  try {
    const { id } = req.params
    const { role } = req.body

    if (req.user.id === parseInt(id)) {
      return res.status(400).json({ error: 'No puedes cambiar tu propio rol' })
    }

    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' })
    }

    const roleId = role === 'admin' ? 1 : 2
    await query('UPDATE users SET role_id = ? WHERE id = ?', [roleId, id])
    res.json({ message: `Rol cambiado a ${role}` })
  } catch (error) {
    console.error('Change user role error:', error)
    res.status(500).json({ error: 'Error al cambiar rol' })
  }
}