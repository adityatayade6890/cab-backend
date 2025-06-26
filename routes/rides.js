const express = require('express');
const router = express.Router();
const db = require('../db');
const ExcelJS = require('exceljs');

// POST /api/rides - Create new ride and calculate fare
router.post('/', async (req, res) => {
  try {
    console.log("▶︎ Payload received:", req.body);

    const {
      customer,
      pickup_location,
      drop_location,
      distance_km,
      distance_source,
      start_km,
      end_km,
      night_charge,
      toll_charge,
      payment_mode,
      driver_name,
    } = req.body;

    if (!customer || !customer.phone || !pickup_location || !drop_location) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const distance = parseFloat(distance_km);
    const startKm = start_km !== '' ? parseInt(start_km) : null;
    const endKm = end_km !== '' ? parseInt(end_km) : null;
    const toll = parseFloat(toll_charge) || 0;

    if (isNaN(distance) || distance <= 0) {
      return res.status(400).json({ error: 'Invalid distance value' });
    }

    const base_rate = 12;
    const night_charge_rate = 2;

    let fare = distance * base_rate;
    if (night_charge) fare += distance * night_charge_rate;
    fare += toll;
    fare = parseFloat(fare.toFixed(2));

    const today = new Date().toISOString().slice(0, 10);
    const countRes = await db.query(`SELECT COUNT(*) FROM rides WHERE created_at::date = $1`, [today]);
    const countToday = parseInt(countRes.rows[0].count || 0) + 1;
    const paddedCount = String(countToday).padStart(5, '0');
    const billNumber = `BILL-${today.replace(/-/g, '')}-${paddedCount}`;

    let customer_id;
    const existing = await db.query('SELECT id FROM customers WHERE phone = $1', [customer.phone]);
    if (existing.rows.length > 0) {
      customer_id = existing.rows[0].id;
    } else {
      const inserted = await db.query(
        'INSERT INTO customers (name, email, phone) VALUES ($1, $2, $3) RETURNING id',
        [customer.name, customer.email, customer.phone]
      );
      customer_id = inserted.rows[0].id;
    }

    const insertRide = await db.query(
      `INSERT INTO rides 
        (customer_id, pickup_location, drop_location, distance_km, distance_source, start_km, end_km, fare_total, night_charge, toll_charge, payment_mode, driver_name, bill_number)
      VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id`, // ✅ this returns the ride ID
      [
        customer_id,
        pickup_location,
        drop_location,
        distance,
        distance_source,
        startKm,
        endKm,
        fare,
        night_charge,
        toll,
        payment_mode,
        driver_name,
        billNumber
      ]
    );

    const rideId = insertRide.rows[0].id;

    res.json({ success: true, fare, billNumber, rideId }); // ✅ send rideId to frontend

  } catch (err) {
    console.error('🔥 Server error:', err.message);
    res.status(500).json({ success: false, error: 'Server error: ' + err.message });
  }
});


// GET /api/rides/export
router.get('/export', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'From and To dates are required' });
    }

    const result = await db.query(
      `SELECT r.id, c.name AS customer_name, c.phone, r.pickup_location, r.drop_location,
              r.distance_km, r.fare_total, r.night_charge,
              r.toll_charge, r.payment_mode, r.driver_name, r.created_at, r.bill_number
       FROM rides r
       JOIN customers c ON r.customer_id = c.id
       WHERE r.created_at::date BETWEEN $1 AND $2
       ORDER BY r.created_at DESC`,
      [from, to]
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Ride Report');

    sheet.columns = [
      { header: 'Ride ID', key: 'id', width: 10 },
      { header: 'Date', key: 'created_at', width: 15 },
      { header: 'Bill No', key: 'bill_number', width: 20 },
      { header: 'Customer Name', key: 'customer_name', width: 20 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Pickup', key: 'pickup_location', width: 20 },
      { header: 'Drop', key: 'drop_location', width: 20 },
      { header: 'KM', key: 'distance_km', width: 10 },
      { header: 'Fare (₹)', key: 'fare_total', width: 10 },
      { header: 'Night', key: 'night_charge', width: 8 },
      { header: 'Toll (₹)', key: 'toll_charge', width: 10 },
      { header: 'Payment', key: 'payment_mode', width: 10 },
      { header: 'Driver', key: 'driver_name', width: 15 },
    ];

    result.rows.forEach((ride) => sheet.addRow(ride));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Ride_Report.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('🔥 Excel Export Error:', err.message);
    res.status(500).json({ error: 'Failed to export report' });
  }
});

// GET /api/rides with filters
router.get('/', async (req, res) => {
  try {
    const { driver, pickup, drop, payment_mode, from_date, to_date } = req.query;

    let query = `SELECT r.*, c.name as customer_name, c.phone 
                 FROM rides r 
                 JOIN customers c ON r.customer_id = c.id 
                 WHERE 1=1`;
    const values = [];
    let i = 1;

    if (driver) {
      query += ` AND LOWER(driver_name) LIKE $${i++}`;
      values.push(`%${driver.toLowerCase()}%`);
    }

    if (pickup) {
      query += ` AND LOWER(pickup_location) LIKE $${i++}`;
      values.push(`%${pickup.toLowerCase()}%`);
    }

    if (drop) {
      query += ` AND LOWER(drop_location) LIKE $${i++}`;
      values.push(`%${drop.toLowerCase()}%`);
    }

    if (payment_mode) {
      query += ` AND payment_mode = $${i++}`;
      values.push(payment_mode);
    }

    if (from_date) {
      query += ` AND r.created_at >= $${i++}`;
      values.push(from_date);
    }

    if (to_date) {
      query += ` AND r.created_at <= $${i++}`;
      values.push(to_date);
    }

    query += ` ORDER BY r.created_at DESC`;

    const result = await db.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/rides/:rideId/preview - Return PDF buffer
router.get('/:rideId/preview', async (req, res) => {
  try {
    const { rideId } = req.params;
    const result = await db.query(`
      SELECT r.*, c.name AS customer_name, c.email, c.phone 
      FROM rides r 
      JOIN customers c ON r.customer_id = c.id 
      WHERE r.id = $1`, [rideId]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Ride not found' });

    const pdfBuffer = await generateBillPDF(result.rows[0]);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('📄 PDF Preview Error:', err.message);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// POST /api/rides/:rideId/send - Send bill via email
router.post('/:rideId/send', async (req, res) => {
  try {
    const { rideId } = req.params;
    const result = await db.query(`
      SELECT r.*, c.name AS customer_name, c.email, c.phone 
      FROM rides r 
      JOIN customers c ON r.customer_id = c.id 
      WHERE r.id = $1`, [rideId]);

    if (result.rows.length === 0) return res.status(404).json({ error: 'Ride not found' });

    const ride = result.rows[0];
    if (!ride.email) return res.status(400).json({ error: 'No customer email found' });

    const pdfBuffer = await generateBillPDF(ride);
    await sendInvoiceEmail(ride, pdfBuffer);

    res.json({ success: true, message: 'Email sent successfully' });
  } catch (err) {
    console.error('📧 Email Send Error:', err.message);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

module.exports = router;
