const express = require('express');
const router = express.Router();
const db = require('../db');

// ✅ Helper: Generate Next Invoice No.
async function generateInvoiceNumber() {
  const result = await db.query('SELECT COUNT(*) FROM bills');
  const count = parseInt(result.rows[0].count, 10) + 1;
  const number = count.toString().padStart(4, '0');
  const year = new Date().getFullYear();
  return `INV-${year}-${number}`;
}

// ✅ POST: Create New Bill
router.post('/', async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const {
      invoice_date,
      order_by,
      used_by,
      trip_details,
      car_id,
      package_qty,
      package_rate,
      extra_km_qty,
      extra_km_rate,
      extra_time_qty,
      extra_time_rate,
      toll,
      driver_allowance
    } = req.body;

    // Calculate total
    const total =
      (package_qty * package_rate) +
      (extra_km_qty * extra_km_rate) +
      (extra_time_qty * extra_time_rate) +
      parseFloat(toll || 0) +
      parseFloat(driver_allowance || 0);

    const invoice_number = await generateInvoiceNumber();

    const result = await client.query(`
      INSERT INTO bills (
        invoice_number, invoice_date, order_by, used_by, trip_details, car_id,
        package_qty, package_rate,
        extra_km_qty, extra_km_rate,
        extra_time_qty, extra_time_rate,
        toll, driver_allowance, total_amount
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12,
        $13,$14,$15
      ) RETURNING id, invoice_number
    `, [
      invoice_number, invoice_date, order_by, used_by, trip_details, car_id,
      package_qty, package_rate,
      extra_km_qty, extra_km_rate,
      extra_time_qty, extra_time_rate,
      toll, driver_allowance, total
    ]);

    await client.query('COMMIT');
    res.json({ success: true, invoice_number: result.rows[0].invoice_number });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Bill insert failed:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  } finally {
    client.release();
  }
});

// ✅ GET: List All Bills
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT b.*, c.vehicle_number, c.owner_name, c.model_name
      FROM bills b
      LEFT JOIN cars c ON b.car_id = c.id
      ORDER BY b.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('🔥 Error fetching bills:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ✅ GET: Cars for Dropdown
router.get('/cars', async (req, res) => {
  try {
    const result = await db.query('SELECT id, vehicle_number, model_name, owner_name FROM cars ORDER BY vehicle_number');
    res.json(result.rows);
  } catch (err) {
    console.error('🔥 Error fetching cars:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
