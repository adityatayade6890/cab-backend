const express = require('express');
const router = express.Router();
const db = require('../db');

// ✅ Helper: Generate Invoice Number Using Sequence
async function generateInvoiceNumber(car) {
  const [carModel = "CAR", carNumber = "XXXX"] =
    car.trim().split(/\s+/);
  
  const carNumberLast4 = carNumber.slice(-4);

  // Use database sequence for unique counter
  const seqResult = await db.query(`SELECT nextval('invoice_seq') AS seq`);
  const seq = String(seqResult.rows[0].seq).padStart(4, '0');

  return `${carModel}-${carNumberLast4}-${seq}`;
}

// ✅ POST: Create New Bill
router.post('/', async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const {
      invoice_date,
      use_date,
      from_date,
      to_date,
      billing_type,
      company_name,
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
    
    // Validate required fields
    if (
      !invoice_date ||
      !order_by ||
      !used_by ||
      !trip_details ||
      !car
    ) {
      await client.query("ROLLBACK");
    
      return res.status(400).json({
        success: false,
        error: "Missing required fields"
      });
    }
    
    // Validate billing dates
    if (billing_type === "Daily" && !use_date) {
      await client.query("ROLLBACK");
    
      return res.status(400).json({
        success: false,
        error: "Use Date is required"
      });
    }
    
    if (
      billing_type !== "Daily" &&
      (!from_date || !to_date)
    ) {
      await client.query("ROLLBACK");
    
      return res.status(400).json({
        success: false,
        error: "Billing period is required"
      });
    }

    // Calculate total
    const packageQty = Number(package_qty) || 0;
    const packageRate = Number(package_rate) || 0;
    
    const extraKmQty = Number(extra_km_qty) || 0;
    const extraKmRate = Number(extra_km_rate) || 0;
    
    const extraTimeQty = Number(extra_time_qty) || 0;
    const extraTimeRate = Number(extra_time_rate) || 0;
    
    const tollAmount = Number(toll) || 0;
    const driverAllowance = Number(driver_allowance) || 0;
    
    const total =
      packageQty * packageRate +
      extraKmQty * extraKmRate +
      extraTimeQty * extraTimeRate +
      tollAmount +
      driverAllowance;

    // ✅ Generate invoice number using sequence
    const invoice_number = await generateInvoiceNumber(car);

    const result = await client.query(`
      INSERT INTO bills (
        invoice_number,
        invoice_date,
        billing_type,
        company_name,
        use_date,
        from_date,
        to_date,
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
        driver_allowance,
        total
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20
      ) 
      RETURNING id, invoice_number
    `, 
    [
      invoice_number,
      invoice_date,
      billing_type,
      company_name,
      use_date,
      from_date,
      to_date,
      order_by,
      used_by,
      trip_details,
      car,
      packageQty,
      packageRate,
      extraKmQty,
      extraKmRate,
      extraTimeQty,
      extraTimeRate,
      tollAmount,
      driverAllowance,
      total
    ]
  );

    await client.query('COMMIT');

    res.json({
      success: true,
      invoice_number: result.rows[0].invoice_number
    });
    
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr);
      }
    
      console.error('❌ Bill insert failed:', err);
    
      res.status(500).json({
        success: false,
        error: 'Internal Server Error'
      });
    } finally {
      client.release();
    }
    });

// ===========================================
// GET BILL HISTORY WITH SEARCH FILTERS
// ===========================================
router.get('/', async (req, res) => {
  try {
    const {
      invoice_number,
      company_name,
      vehicle,
      billing_type,
      payment_status,
      from_date,
      to_date
    } = req.query;
    let sql = `
      SELECT *
      FROM bills
      WHERE 1 = 1
    `;
    const values = [];
    let index = 1;
    // -------------------------
    // Invoice Number
    // ------------------------
    if (invoice_number) {
      sql += `
      AND invoice_number ILIKE $${index}
      `;
      values.push(`%${invoice_number}%`);
      index++;
    }
    // -------------------------
    // Company
    // -------------------------
    if (company_name) {
      sql += `
      AND company_name = $${index}
      `;
      values.push(company_name);
      index++;
    }

    // -------------------------
    // Vehicle Number
    // -------------------------

    if (vehicle) {
      sql += `
      AND car ILIKE $${index}
      `;
      values.push(`%${vehicle}%`);
      index++;
    }

    // -------------------------
    // Billing Type
    // -------------------------

    if (billing_type) {
      sql += `
      AND billing_type = $${index}
      `;
      values.push(billing_type);
      index++;
    }

    // -------------------------
    // Payment Status
    // -------------------------

    if (payment_status) {
      sql += `
      AND payment_status = $${index}
      `;
      values.push(payment_status);
      index++;
    }

    // -------------------------
    // From Date
    // -------------------------
    if (from_date) {
      sql += `
      AND invoice_date >= $${index}
      `;
      values.push(from_date);
      index++;
    }
    // -------------------------
    // To Date
    // -------------------------
    if (to_date) {
      sql += `
      AND invoice_date <= $${index}
      `;
      values.push(to_date);
      index++;
    }
    sql += `
      ORDER BY
      invoice_date DESC,
      created_at DESC
    `;
    const result = await db.query(sql, values);
    res.json(result.rows);
  }
  catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// =====================================
// MARK BILL AS PAID
// =====================================

router.put("/:id/paid", async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            `
            UPDATE bills
            SET  payment_status =  CASE  WHEN payment_status='Paid'  THEN 'Pending'  ELSE 'Paid'  END
            WHERE id=$1
            RETURNING *
            `,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({
                success:false,
                message:"Bill Not Found"
            });
        }
        res.json({
            success:true,
            message:"Bill Marked As Paid",
            bill:result.rows[0]
        });
    }
    catch(err){
        console.log(err);
        res.status(500).json({
            success:false,
            message:err.message
        });
    }
});

module.exports = router;
