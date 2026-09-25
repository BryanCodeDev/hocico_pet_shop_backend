-- ============================================================
-- Seed data para Hocico Pet Shop
-- Ejecutar manualmente después de correr el esquema principal
-- No contiene datos de prueba/demo genéricos — está enfocado
-- al negocio real: alimentos, snacks y accesorios para mascotas
-- ============================================================

-- ------------------------------------------------------------
-- ROLES
-- ------------------------------------------------------------
INSERT IGNORE INTO `roles` (`id`, `name`, `description`, `permissions`) VALUES
(1, 'admin', 'Administrador de la tienda', JSON_OBJECT('all', TRUE)),
(2, 'user', 'Cliente registrado', JSON_OBJECT('orders', JSON_ARRAY('read', 'create'), 'profile', JSON_ARRAY('read', 'update'), 'cart', JSON_ARRAY('read', 'create', 'update', 'delete'))),
(3, 'guest', 'Cuenta invitada / soporte', JSON_OBJECT('cart', JSON_ARRAY('read', 'create', 'update', 'delete'))),
(4, 'cashier', 'Cajero de punto de venta', JSON_OBJECT('pos', JSON_ARRAY('read', 'create'), 'cash_registers', JSON_ARRAY('read', 'create', 'update')));

-- ------------------------------------------------------------
-- USUARIO ADMIN
-- (contraseña temporal: cámbiala apenas ingreses la primera vez)
-- ------------------------------------------------------------
INSERT IGNORE INTO `users` (`first_name`, `last_name`, `email`, `password_hash`, `role_id`, `phone`, `city`, `province`, `is_active`, `email_verified`) VALUES
('Hocico', 'Admin', 'admin@hocicopetshop.com', '$2a$12$kzlsqHY/QgEcOxqnX22zv.P1h.oRrupoNzW.2jBDdUfy5lAu1nRyi', 1, '3133245600', 'Mosquera', 'Cundinamarca', TRUE, TRUE);

-- ------------------------------------------------------------
-- CATEGORÍAS (jerárquicas: Alimentos > Perro/Gato)
-- ------------------------------------------------------------
INSERT IGNORE INTO `categories` (`id`, `name`, `slug`, `description`, `parent_id`, `is_active`, `sort_order`) VALUES
(1, 'Alimentos', 'alimentos', 'Alimento seco y húmedo para perros y gatos', NULL, TRUE, 1),
(2, 'Alimento para Perro', 'alimento-perro', 'Concentrados y alimento húmedo para perros de todas las edades', 1, TRUE, 1),
(3, 'Alimento para Gato', 'alimento-gato', 'Concentrados y alimento húmedo para gatos de todas las edades', 1, TRUE, 2),
(4, 'Snacks', 'snacks', 'Premios, huesos y galletas para consentir a tu mascota', NULL, TRUE, 2),
(5, 'Accesorios', 'accesorios', 'Correas, camas, comederos, transportadoras y más', NULL, TRUE, 3),
(6, 'Higiene y Cuidado', 'higiene-cuidado', 'Shampoos, cepillos y productos de aseo', NULL, TRUE, 4);

-- ------------------------------------------------------------
-- MARCAS
-- ------------------------------------------------------------
INSERT IGNORE INTO `brands` (`id`, `name`, `slug`, `description`, `is_active`) VALUES
(1, 'Hill''s', 'hills', 'Alimento científico premium para perros y gatos', TRUE),
(2, 'Agility Gold', 'agility-gold', 'Alimento balanceado de alto rendimiento', TRUE),
(3, 'Genérico', 'generico', 'Accesorios y productos varios sin marca específica', TRUE);

-- ------------------------------------------------------------
-- ZONAS DE ENVÍO (si no vienen ya del esquema principal)
-- ------------------------------------------------------------
INSERT IGNORE INTO `shipping_zones` (`city`, `cost`) VALUES
('Mosquera', 0),
('Madrid', 5000),
('Funza', 5000);

-- ------------------------------------------------------------
-- PRODUCTOS
-- ------------------------------------------------------------
INSERT INTO `products` (
  `category_id`, `brand_id`, `name`, `slug`, `sku`, `short_description`, `description`,
  `specifications`, `features`, `warranty`, `price`, `original_price`, `discount_percent`,
  `cost_price`, `stock`, `min_stock`, `weight`, `dimensions`, `is_active`, `is_featured`,
  `is_new`, `is_on_sale`, `meta_title`, `meta_description`
) VALUES

(2, 1, 'Hill''s Science Diet Adult Perro 15kg', 'hills-adult-perro-15kg', 'ALI-PERRO-001',
 'Alimento científico para perros adultos, cuidado digestivo y piel saludable.',
 '<p>Fórmula balanceada con nutrientes de alta calidad para perros adultos. Favorece la digestión, mantiene el peso ideal y da brillo al pelaje.</p>',
 JSON_OBJECT('Presentación', '15 kg', 'Edad', 'Adulto', 'Especie', 'Perro'),
 JSON_ARRAY('Cuidado digestivo', 'Piel y pelaje saludable', 'Alta digestibilidad'),
 'No aplica', 289900, NULL, 0, 210000, 15, 3, 15.000, '60 x 40 x 15 cm',
 TRUE, TRUE, FALSE, FALSE, 'Hill''s Adult Perro 15kg', 'Alimento Hill''s para perros adultos, bolsa de 15kg.'),

(3, 1, 'Hill''s Science Diet Adult Gato 3kg', 'hills-adult-gato-3kg', 'ALI-GATO-001',
 'Alimento científico para gatos adultos, salud urinaria y pelo brillante.',
 '<p>Nutrición balanceada que ayuda a mantener la salud del tracto urinario y un pelaje brillante en gatos adultos.</p>',
 JSON_OBJECT('Presentación', '3 kg', 'Edad', 'Adulto', 'Especie', 'Gato'),
 JSON_ARRAY('Salud urinaria', 'Pelaje brillante', 'Control de peso'),
 'No aplica', 89900, NULL, 0, 65000, 20, 5, 3.000, '30 x 20 x 8 cm',
 TRUE, TRUE, FALSE, FALSE, 'Hill''s Adult Gato 3kg', 'Alimento Hill''s para gatos adultos, bolsa de 3kg.'),

(2, 2, 'Agility Gold Cachorro Premios 500g', 'agility-gold-cachorro-premios-500g', 'SNK-PERRO-001',
 'Snack de premio para cachorros, ideal para entrenamiento.',
 '<p>Premios crocantes formulados para cachorros, ideales para reforzar el entrenamiento y la buena conducta.</p>',
 JSON_OBJECT('Presentación', '500 g', 'Edad', 'Cachorro', 'Especie', 'Perro'),
 JSON_ARRAY('Ideal para entrenamiento', 'Sabor irresistible', 'Fácil digestión'),
 'No aplica', 22900, NULL, 0, 15000, 30, 8, 0.500, '20 x 15 x 5 cm',
 TRUE, FALSE, TRUE, FALSE, 'Agility Gold Premios Cachorro', 'Snack premio Agility Gold para cachorros, 500g.'),

(4, 3, 'Hueso Prensado Natural para Perro', 'hueso-prensado-natural-perro', 'SNK-PERRO-002',
 'Hueso prensado 100% natural, ayuda a la limpieza dental.',
 '<p>Snack masticable de larga duración que ayuda a reducir el sarro y mantener los dientes limpios.</p>',
 JSON_OBJECT('Presentación', 'Unidad', 'Especie', 'Perro'),
 JSON_ARRAY('Limpieza dental', '100% natural', 'Larga duración'),
 'No aplica', 12900, NULL, 0, 7500, 40, 10, 0.150, '18 x 5 x 5 cm',
 TRUE, FALSE, FALSE, FALSE, 'Hueso Prensado Natural', 'Hueso prensado natural para la limpieza dental de tu perro.'),

(5, 3, 'Correa Retráctil para Perro 5m', 'correa-retractil-perro-5m', 'ACC-PERRO-001',
 'Correa retráctil resistente, ideal para paseos cómodos y seguros.',
 '<p>Correa retráctil de 5 metros con freno de seguridad, mango ergonómico y cinta resistente.</p>',
 JSON_OBJECT('Longitud', '5 m', 'Material', 'Nylon reforzado'),
 JSON_ARRAY('Freno de seguridad', 'Mango ergonómico', 'Resistente al desgaste'),
 '3 meses', 45900, 59900, 23, 28000, 25, 5, 0.300, '15 x 10 x 8 cm',
 TRUE, TRUE, FALSE, TRUE, 'Correa Retráctil 5m', 'Correa retráctil para perro, 5 metros, con freno de seguridad.'),

(5, 3, 'Cama Acolchada para Mascota Talla M', 'cama-acolchada-mascota-talla-m', 'ACC-CAMA-001',
 'Cama suave y acolchada, lavable, ideal para perros y gatos medianos.',
 '<p>Cama redonda acolchada con base antideslizante, funda desmontable y lavable a máquina.</p>',
 JSON_OBJECT('Talla', 'M', 'Diámetro', '60 cm', 'Lavable', 'Sí'),
 JSON_ARRAY('Funda desmontable', 'Base antideslizante', 'Material hipoalergénico'),
 '3 meses', 69900, NULL, 0, 42000, 12, 3, 0.900, '60 x 60 x 15 cm',
 TRUE, FALSE, TRUE, FALSE, 'Cama Acolchada Talla M', 'Cama acolchada lavable para perros y gatos, talla mediana.'),

(6, 3, 'Shampoo Hipoalergénico para Mascotas 500ml', 'shampoo-hipoalergenico-mascotas-500ml', 'HIG-SHAMP-001',
 'Shampoo suave para piel sensible, deja el pelaje brillante y sedoso.',
 '<p>Fórmula hipoalergénica libre de parabenos, ideal para mascotas con piel sensible.</p>',
 JSON_OBJECT('Presentación', '500 ml', 'Tipo', 'Hipoalergénico'),
 JSON_ARRAY('Libre de parabenos', 'pH balanceado', 'Aroma suave'),
 'No aplica', 32900, NULL, 0, 19000, 20, 5, 0.550, '20 x 8 x 8 cm',
 TRUE, FALSE, FALSE, FALSE, 'Shampoo Hipoalergénico', 'Shampoo hipoalergénico para perros y gatos, 500ml.');

-- Nota: las imágenes de producto se deben cargar desde el panel admin
-- (Cloudinary) o insertarse manualmente en `product_images` con las
-- URLs reales de cada producto.