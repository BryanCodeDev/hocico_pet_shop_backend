export function errorHandler(err, req, res, next) {
  console.error('Error:', err)

  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: 'Datos de validación inválidos', details: err.errors })
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'No autorizado' })
  }

  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Registro duplicado' })
  }

  if (err.code === 'ER_NO_REFERENCED_ROW_2' || err.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(400).json({ error: 'Error de integridad referencial' })
  }

  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Error interno del servidor' : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  })
}

