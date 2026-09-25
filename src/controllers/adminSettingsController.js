import { query, queryOne, transaction } from '../config/database.js'
import cloudinary from '../config/cloudinary.js'

export async function getSettings(req, res) {
  try {
    const settings = await query('SELECT `key`, value, description FROM settings')
    const settingsObj = {}
    settings.forEach(s => {
      settingsObj[s.key] = s.value
    })
    res.json({ settings: settingsObj })
  } catch (error) {
    console.error('Get settings error:', error)
    res.status(500).json({ error: 'Error al obtener configuración' })
  }
}

export async function updateSettings(req, res) {
  try {
    const { settings } = req.body

    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Configuración inválida' })
    }

    await transaction(async (conn) => {
      for (const [key, value] of Object.entries(settings)) {
        await conn.execute(
          `INSERT INTO settings (\`key\`, value, description) VALUES (?, ?, '')
           ON DUPLICATE KEY UPDATE value = ?, updated_at = CURRENT_TIMESTAMP`,
          [key, JSON.stringify(value), JSON.stringify(value)]
        )
      }
    })

    res.json({ message: 'Configuración actualizada correctamente' })
  } catch (error) {
    console.error('Update settings error:', error)
    res.status(500).json({ error: 'Error al actualizar configuración' })
  }
}

export async function uploadLogo(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se proporcionó archivo' })
    }

    const uploadResult = await cloudinary.uploader.upload(req.file.path, {
      folder: 'techstore/settings',
      resource_type: 'image',
      public_id: 'logo',
      overwrite: true,
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
    })

    await query(
      `INSERT INTO settings (\`key\`, value, description) VALUES ('site_logo', ?, 'Logo del sitio')
       ON DUPLICATE KEY UPDATE value = ?, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(uploadResult.secure_url), JSON.stringify(uploadResult.secure_url)]
    )

    res.json({ url: uploadResult.secure_url })
  } catch (error) {
    console.error('Upload logo error:', error)
    res.status(500).json({ error: 'Error al subir logo' })
  }
}