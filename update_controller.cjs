const fs = require('fs');
let content = fs.readFileSync('src/controllers/productController.js', 'utf8');

// Add import after existing import
content = content.replace(
  "import { validationResult } from 'express-validator'",
  "import { validationResult } from 'express-validator'\nimport { mapProduct } from '../utils/helpers.js'"
);

// Replace ALL instances of ...p,\n        images: with ...mapProduct(p),\n        images:
content = content.replace(/\.\.\.p,\n(\s*)images:/g, '...mapProduct(p),\n$1images:');

// Remove duplicate discount lines that mapProduct now handles
content = content.replace(/,\n(\s*)discount: p\.original_price && p\.price < p\.original_price\n\1\?\s*Math\.round\(\(\(p\.original_price - p\.price\) \/ p\.original_price\) \* 100\)\n\1: 0,\n/g, ',\n$1');

// Also remove the discount line in getProductBySlug and getProductById
content = content.replace(/discount: product\.original_price && product\.price < product\.original_price\n\s*\?\s*Math\.round\(\(\(product\.original_price - product\.price\) \/ product\.original_price\) \* 100\)\n\s*: 0,\n/g, '');
content = content.replace(/discount: p\.original_price && p\.price < p\.original_price\n\s*\?\s*Math\.round\(\(\(p\.original_price - p\.price\) \/ p\.original_price\) \* 100\)\n\s*: 0,\n/g, '');

fs.writeFileSync('src/controllers/productController.js', content);
console.log('Controller updated');
