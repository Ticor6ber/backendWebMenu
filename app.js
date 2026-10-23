const express = require("express");
const app = express();
const cors = require("cors");
const port = process.env.PORT || 3000;
require('dotenv').config();
const sql = require('./db');

app.use(express.json());

app.use(cors());

// Endpoint para obtener el catálogo con los impuestos incluidos
app.get('/api/productos', async (req, res) => {
  try {
    const products = await sql`
      SELECT
        p.product_id,
        p.p_name,
        p.p_price,
        p.p_img,
        CASE
          WHEN t.tax_id IS NULL THEN NULL
          ELSE json_build_object(
            'tax_name', t.tax_name,
            'tax_percentage', t.tax_percentage
          )
        END AS "Taxes"
      FROM "Products" AS p
      LEFT JOIN "Taxes" AS t ON t.tax_id = p.p_taxid
      ORDER BY p.product_id
    `;

    return res.json(products);
  } catch (error) {
    console.error('Error consultando PostgreSQL:', error);
    return res.status(500).json({ error: 'Error al consultar el catálogo' });
  }
});

app.post('/api/orders', async (req, res) => {
  const { cart, total } = req.body;

  if (!cart || cart.length === 0) {
    return res.status(400).json({ error: 'El carrito está vacío' });
  }

  try {
    // Iniciamos una transacción SQL
    const orderResult = await sql.begin(async (sqlTransaccion) => {
      
      // 1. Insertar el registro principal en la tabla "orders"
      const [newOrder] = await sqlTransaccion`
        INSERT INTO "orders" (total, status)
        VALUES (${total}, 'Completado')
        RETURNING id, created_at, total, status
      `;

      // 2. Preparar el arreglo de artículos para insertar
      const itemsParaInsertar = cart.map(item => ({
        order_id: newOrder.id,
        product_id: item.id,
        quantity: item.cantidad,
        unit_price: item.precio,
        tax_rate: item.porcentajeImpuesto
      }));

      // 3. Insertar todos los artículos en "order_items" de un solo golpe
      await sqlTransaccion`
        INSERT INTO "order_items" ${ sqlTransaccion(itemsParaInsertar) }
      `;

      return newOrder; // Retornamos la orden creada
    });

    return res.status(201).json({ 
      mensaje: 'Pedido confirmado exitosamente', 
      orden: orderResult 
    });

  } catch (error) {
    console.error('Error al guardar el pedido:', error);
    return res.status(500).json({ error: 'Hubo un error al procesar el pago' });
  }
});

// Endpoint para obtener una orden completa (total, impuestos, artículos y fecha)
app.get('/api/orders/:id', async (req, res) => {
  const { id } = req.params;

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'ID de orden inválido' });
  }

  try {
    const [orden] = await sql`
      SELECT
        o.id,
        o.created_at::date::text AS order_date,
        o.total,
        o.status,
        COALESCE(
          json_agg(
            json_build_object(
              'product_id', oi.product_id,
              'quantity', oi.quantity,
              'unit_price', oi.unit_price,
              'tax_rate', oi.tax_rate,
              'Products', json_build_object('p_name', p.p_name)
            ) ORDER BY oi.id
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'::json
        ) AS order_items
      FROM "orders" AS o
      LEFT JOIN "order_items" AS oi ON oi.order_id = o.id
      LEFT JOIN "Products" AS p ON p.product_id = oi.product_id
      WHERE o.id = ${id}
      GROUP BY o.id
    `;

    if (!orden) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    return res.json({ orden });
  } catch (error) {
    console.error('Error consultando la orden:', error);
    return res.status(500).json({ error: 'Error al consultar la orden' });
  }
});

app.listen(port, () => {
  console.log(`Server app running at: http://localhost:${port}`);
});
