const express = require("express");
const { Pool } = require("pg");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.get("/", (req, res) => {
  res.send("ESP32 API is running");
});

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "success",
      message: "API and database are working"
    });
  } catch (err) {
    console.error("Health check error:", err);
    res.status(500).json({
      status: "error",
      message: "Database connection failed"
    });
  }
});

app.post("/api/sensor", async (req, res) => {
  try {
    const { level, timestamp, device_id, device_name } = req.body;

    if (
      level === undefined ||
      timestamp === undefined ||
      !device_id ||
      !device_name
    ) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields: level, timestamp, device_id, device_name"
      });
    }

    const levelValue = Number(level);
    const timestampValue = String(timestamp).trim();
    const deviceIdValue = String(device_id).trim();
    const deviceNameValue = String(device_name).trim();

    if (Number.isNaN(levelValue)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid level value"
      });
    }

    if (!timestampValue) {
      return res.status(400).json({
        status: "error",
        message: "Invalid timestamp value"
      });
    }

    const query = `
      INSERT INTO sensor_readings (level, timestamp_raw, device_id, device_name)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `;

    const values = [
      levelValue,
      timestampValue,
      deviceIdValue,
      deviceNameValue
    ];

    const result = await pool.query(query, values);

    return res.status(200).json({
      status: "success",
      message: "Data saved",
      reading_id: result.rows[0]?.id || null
    });
  } catch (err) {
    console.error("Insert error:", err);
    return res.status(500).json({
      status: "error",
      message: "DB ERROR",
      details: err.message
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Route not found"
  });
});

const port = process.env.PORT || 10000;

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});
