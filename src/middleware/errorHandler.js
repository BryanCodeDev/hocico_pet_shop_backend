export function errorHandler(err, req, res, next) {
  console.error('Error:', err)

  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: 'Datos de validación inválidos', details: err.errors })
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: 'No autorizado' })
  }

  // Errores del parser del cuerpo: ya vienen con su código y su tipo. Sin esta
  // rama, un JSON malformado (400) o un payload de más de 10 MB (413) se
  // reportaban como 500 y ensuciaban el monitoreo con errores de servidor que
  // en realidad son culpa del cliente.
  if (err.type === 'entity.parse.failed' || err.status === 400) {
    return res.status(400).json({ error: 'JSON inválido en el cuerpo de la petición' })
  }
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'El cuerpo de la petición excede el límite de 10 MB' })
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

