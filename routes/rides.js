const express = require('express');
const router = express.Router();
const db = require('../db');

// ✅ Helper: Generate Invoice Number Using Sequence
async function generateInvoiceNumber(car, invoiceDate) {
  const carParts = car.trim().split(' ');
  const carModel = carParts[0]?.toUpperCase() || 'CAR';
  const carNumber = carParts[1]?.toUpperCase() || 'XXXX';
  const carNumberLast4 = carNumber.slice(-4);
  const formattedDate = invoiceDate.replace(/-/g, '');

  // Use database sequence for unique counter
  const seqResult = await db.query(`SELECT nextval('invoice_seq') AS seq`);
  const seq = String(seqResult.rows[0].seq).padStart(4, '0');

  return `INV-${carModel}-${carNumberLast4}-${formattedDate}-${seq}`;
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
      car,
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

    // ✅ Generate invoice number using sequence
    const invoice_number = await generateInvoiceNumber(car, invoice_date);

    const result = await client.query(`
      INSERT INTO bills (
        invoice_number, invoice_date, order_by, used_by, trip_details, car,
        package_qty, package_rate,
        extra_km_qty, extra_km_rate,
        extra_time_qty, extra_time_rate,
        toll, driver_allowance, total
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12,
        $13,$14,$15
      ) RETURNING id, invoice_number
    `, [
      invoice_number, invoice_date, order_by, used_by, trip_details, car,
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
      SELECT *
      FROM bills
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('🔥 Error fetching bills:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
