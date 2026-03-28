const express = require("express");
const { Pool } = require("pg");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =========================
   INIT DATABASE
========================= */
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sensor_readings (
        id SERIAL PRIMARY KEY,
        water_level NUMERIC(5,2) NOT NULL,
        device_timestamp BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        device_id VARCHAR(50)
      );
    `);

    console.log("✅ Table ready");
  } catch (err) {
    console.error("❌ DB INIT ERROR:", err);
  }
}

/* =========================
   ROUTES
========================= */

// Home
app.get("/", (req, res) => {
  res.send("ESP32 API is running");
});

// Health check
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "success",
      message: "API and database are working"
    });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: "Database connection failed"
    });
  }
});

// ✅ LATEST DATA
app.get("/api/latest", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM sensor_readings
      ORDER BY id DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "No data yet"
      });
    }

    res.json({
      status: "success",
      data: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "error",
      message: "DB ERROR"
    });
  }
});

// ✅ HISTORY (optional but useful)
app.get("/api/history", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM sensor_readings
      ORDER BY id DESC
      LIMIT 50
    `);

    res.json({
      status: "success",
      data: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "error",
      message: "DB ERROR"
    });
  }
});

// ESP32 POST
app.post("/api/sensor", async (req, res) => {
  try {
    const { level, timestamp, device_id } = req.body;

    if (level === undefined || timestamp === undefined || !device_id) {
      return res.status(400).json({
        status: "error",
        message: "Missing fields"
      });
    }

    const result = await pool.query(
      `INSERT INTO sensor_readings (water_level, device_timestamp, device_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [Number(level), Number(timestamp), device_id]
    );

    res.json({
      status: "success",
      message: "Data saved",
      data: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "error",
      message: "DB ERROR",
      details: err.message
    });
  }
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Route not found"
  });
});

/* =========================
   START SERVER
========================= */

const port = process.env.PORT || 10000;

app.listen(port, "0.0.0.0", async () => {
  console.log(`Server running on port ${port}`);
  await initDB();
});
