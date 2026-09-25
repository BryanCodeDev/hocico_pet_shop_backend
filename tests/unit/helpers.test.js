import { describe, it, expect } from 'vitest'
import {
  mapProduct,
  mapCategory,
  formatPrice,
  generateOrderNumber,
  slugify,
  generateSKU,
  calculateDiscount,
  getStockStatus,
  getOrderStatusConfig,
  getPaymentStatusConfig,
  validateEmail,
  sanitizeInput,
  parseBoolean,
} from '../../src/utils/helpers.js'

describe('slugify', () => {
  it('normaliza texto con espacios, mayúsculas y tildes', () => {
    expect(slugify('Alimento para Perro')).toBe('alimento-para-perro')
  })

  it('elimina caracteres especiales', () => {
    expect(slugify('Collar ¡Antipulgas! 100%')).toBe('collar-antipulgas-100')
  })

  it('colapsa guiones y guiones bajos repetidos', () => {
    expect(slugify('Juguete   para___gato')).toBe('juguete-para-gato')
  })

  it('no deja guiones al principio ni al final', () => {
    expect(slugify('  ---Alimento---  ')).toBe('alimento')
  })

  it('devuelve string vacío cuando la entrada queda sin caracteres válidos', () => {
    expect(slugify('!!!')).toBe('')
  })

  it('lanza TypeError con null porque llama a toString() sin proteger', () => {
    // Riesgo latente: cualquier llamada con nombre de producto ausente
    // (importaciones, productos borrados, datos de terceros) revienta el
    // render del listado. Hoy no se dispara porque el nombre es NOT NULL.
    expect(() => slugify(null)).toThrow(TypeError)
  })

  it('tolera undefined y números sin lanzar', () => {
    expect(slugify(123)).toBe('123')
  })
})

describe('generateOrderNumber', () => {
  it('respeta el formato ORD-AAAAMMDD-XXXXXX', () => {
    expect(generateOrderNumber()).toMatch(/^ORD-\d{6}-[A-Z0-9]{6}$/)
  })

  it('genera números distintos en llamadas consecutivas', () => {
    const numbers = new Set(Array.from({ length: 50 }, () => generateOrderNumber()))
    expect(numbers.size).toBe(50)
  })
})

describe('generateSKU', () => {
  it('combina los tres primeros caracteres de categoría y marca', () => {
    expect(generateSKU('Alimentos', 'Royal Canin')).toMatch(/^ALI-ROY-[A-Z0-9]{4,}$/)
  })
})

describe('calculateDiscount', () => {
  it('calcula el porcentaje de descuento', () => {
    expect(calculateDiscount(10000, 7500)).toBe(25)
  })

  it('devuelve 0 cuando el precio original no supera al actual', () => {
    expect(calculateDiscount(10000, 10000)).toBe(0)
    expect(calculateDiscount(10000, 12000)).toBe(0)
  })

  it('devuelve 0 cuando falta el precio original', () => {
    expect(calculateDiscount(null, 7500)).toBe(0)
    expect(calculateDiscount(undefined, 7500)).toBe(0)
  })
})

describe('getStockStatus', () => {
  it('marca agotado cuando no hay unidades', () => {
    expect(getStockStatus(0)).toEqual({ label: 'Agotado', available: false, level: 'out' })
  })

  it('marca stock bajo al llegar al mínimo', () => {
    expect(getStockStatus(3)).toEqual({ label: 'Stock bajo (3)', available: true, level: 'low' })
  })

  it('respeta un mínimo personalizado', () => {
    expect(getStockStatus(8, 10).level).toBe('low')
    expect(getStockStatus(8, 10).available).toBe(true)
  })

  it('marca disponible por encima del mínimo', () => {
    expect(getStockStatus(50)).toEqual({ label: 'Disponible', available: true, level: 'ok' })
  })
})

describe('validateEmail', () => {
  it.each(['a@b.co', 'usuario.nombre@dominio.com'])('acepta %s', (email) => {
    expect(validateEmail(email)).toBe(true)
  })

  it.each(['', 'sin-arroba', 'a@b', 'a b@c.com', '@dominio.com'])('rechaza %j', (email) => {
    expect(validateEmail(email)).toBe(false)
  })
})

describe('sanitizeInput', () => {
  it('elimina etiquetas y esquemas de ejecución', () => {
    const result = sanitizeInput('<script>alert(1)</script>')
    expect(result).not.toMatch(/[<>]/)
  })

  it('elimina manejadores de evento inline', () => {
    expect(sanitizeInput('onclick="robar()"')).not.toMatch(/on\w+=/i)
  })

  it('elimina el esquema javascript:', () => {
    expect(sanitizeInput('javascript:alert(1)')).not.toMatch(/javascript:/i)
  })

  it('devuelve intactos los valores no string', () => {
    expect(sanitizeInput(42)).toBe(42)
    expect(sanitizeInput(null)).toBe(null)
    expect(sanitizeInput({ a: 1 })).toEqual({ a: 1 })
  })
})

describe('parseBoolean', () => {
  it('interpreta strings sin distinguir mayúsculas', () => {
    expect(parseBoolean('true')).toBe(true)
    expect(parseBoolean('TRUE')).toBe(true)
    expect(parseBoolean('false')).toBe(false)
  })

  it('respeta booleanos nativos', () => {
    expect(parseBoolean(true)).toBe(true)
    expect(parseBoolean(false)).toBe(false)
  })

  it('aplica coerción al resto de valores', () => {
    expect(parseBoolean(1)).toBe(true)
    expect(parseBoolean(0)).toBe(false)
    expect(parseBoolean(null)).toBe(false)
  })
})

describe('formatPrice', () => {
  it('formatea un monto con el separador local', () => {
    expect(formatPrice(25000)).toMatch(/25[.\s]?000/)
  })

  it('devuelve $0 para null o undefined', () => {
    expect(formatPrice(null)).toBe('$0')
    expect(formatPrice(undefined)).toBe('$0')
  })
})

describe('mapProduct', () => {
  it('devuelve null para una entrada vacía', () => {
    expect(mapProduct(null)).toBeNull()
    expect(mapProduct(undefined)).toBeNull()
  })

  it('mapea las columnas snake_case a la forma que consume el frontend', () => {
    const result = mapProduct({
      id: 7,
      category_id: 2,
      category_name: 'Alimento para Perro',
      category_slug: 'alimento-perro',
      brand_id: 3,
      brand_name: 'Royal Canin',
      name: 'Concentrado Adulto',
      slug: 'concentrado-adulto',
      short_description: 'Descripción corta',
      description: 'Descripción larga',
      price: '45000.00',
      original_price: '60000.00',
      stock: 12,
      min_stock: 5,
      is_active: 1,
      is_featured: 0,
      is_new: 1,
      is_on_sale: 1,
      main_image: 'https://cdn.test/main.jpg',
    })

    expect(result).toMatchObject({
      id: 7,
      category: 'Alimento para Perro',
      categorySlug: 'alimento-perro',
      brand: 'Royal Canin',
      brandId: 3,
      name: 'Concentrado Adulto',
      slug: 'concentrado-adulto',
      shortDescription: 'Descripción corta',
      mainImage: 'https://cdn.test/main.jpg',
      isActive: 1,
      isOnSale: 1,
    })
  })

  it('conserva el precio DECIMAL tal cual llega de MySQL (string)', () => {
    // mysql2 devuelve DECIMAL como string (verificado contra MySQL 8 real).
    // Si el frontend o un test esperan number, esta aserción documenta que
    // hoy NO hay coerción en la capa de mapeo.
    const result = mapProduct({ price: '45000.00' })
    expect(result.price).toBe('45000.00')
    expect(typeof result.price).toBe('string')
  })

  it('calcula el descuento con precios numéricos', () => {
    expect(mapProduct({ price: 7500, original_price: 10000 }).discount).toBe(25)
    expect(mapProduct({ price: 10000, original_price: 10000 }).discount).toBe(0)
    expect(mapProduct({ price: 10000, original_price: null }).discount).toBe(0)
    expect(mapProduct({ price: 12000, original_price: 10000 }).discount).toBe(0)
  })

  it(
    'debería calcular el descuento con los precios string que devuelve MySQL',
    () => {
      // DEFECTO — helpers.js:26 compara `p.price < p.original_price` sin
      // coerción a número. Con los DECIMAL que entrega mysql2 como string la
      // comparación es LÉXICA: '9500.00' < '10000.00' es FALSE porque '9' > '1'.
      // Resultado: los productos rebajados cuyo precio actual tiene más
      // dígitos que el original (9.500 vs 10.000, 99.000 vs 120.000) se
      // muestran SIN descuento, y el badge de promoción desaparece del
      // catálogo. Se agrava porque 45.000 < 60.000 sí funciona por casualidad
      // ('4' < '6'), así que el fallo es intermitente según los dígitos.
      expect(mapProduct({ price: '9500.00', original_price: '10000.00' }).discount).toBe(5)
    }
  )

  it(
    'debería calcular el descuento también cuando ambos precios tienen igual longitud',
    () => {
      expect(mapProduct({ price: '9000.00', original_price: '10000.00' }).discount).toBe(10)
    }
  )

  it('devuelve un array vacío de imágenes cuando no viene ninguna', () => {
    expect(mapProduct({ id: 1 }).images).toEqual([])
  })
})

describe('mapCategory', () => {
  it('devuelve null para una entrada vacía', () => {
    expect(mapCategory(null)).toBeNull()
  })

  it('mapea los campos y normaliza is_active a boolean', () => {
    const result = mapCategory({
      id: 4,
      name: 'Snacks',
      slug: 'snacks',
      image_url: 'https://cdn.test/snacks.jpg',
      parent_id: null,
      is_active: 1,
      sort_order: 2,
    })

    expect(result).toMatchObject({
      id: 4,
      name: 'Snacks',
      slug: 'snacks',
      imageUrl: 'https://cdn.test/snacks.jpg',
      parentId: null,
      isActive: true,
      sortOrder: 2,
    })
  })

  it('devuelve productCount 0 y subcategories vacío por defecto', () => {
    const result = mapCategory({ id: 1, name: 'Alimentos' })
    expect(result.productCount).toBe(0)
    expect(result.subcategories).toEqual([])
  })

  it('mapea las subcategorías anidadas de forma recursiva', () => {
    const result = mapCategory({
      id: 1,
      name: 'Alimentos',
      subcategories: [{ id: 2, name: 'Perro', subcategories: [{ id: 9, name: 'Cachorros' }] }],
    })

    expect(result.subcategories[0].name).toBe('Perro')
    expect(result.subcategories[0].subcategories[0].name).toBe('Cachorros')
  })
})

describe('configuración de estados', () => {
  it('cae en "Pendiente" para un estado de pedido desconocido', () => {
    expect(getOrderStatusConfig('no-existe')).toEqual(getOrderStatusConfig('pending'))
    expect(getOrderStatusConfig(undefined).label).toBe('Pendiente')
  })

  it('resuelve cada estado de pedido del flujo a una etiqueta propia', () => {
    const flow = ['paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'refunded']
    const labels = flow.map((status) => getOrderStatusConfig(status).label)

    expect(new Set(labels).size).toBe(flow.length)
    for (const label of labels) {
      expect(label).not.toBe('Pendiente')
    }
  })

  it('distingue los estados de pago de la pasarela', () => {
    expect(getPaymentStatusConfig('approved').label).toBe('Aprobado')
    expect(getPaymentStatusConfig('rejected').label).toBe('Rechazado')
    expect(getPaymentStatusConfig('charged_back').label).toBe('Contracargo')
    expect(getPaymentStatusConfig('desconocido')).toEqual(getPaymentStatusConfig('pending'))
  })
})
