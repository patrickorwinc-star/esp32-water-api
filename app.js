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

app.post("/api/sensor", async (req, res) => {
  try {
    const { level, timestamp, device_id, device_name } = req.body;

    if (level === undefined || timestamp === undefined) {
      return res.status(400).send("Missing data");
    }

    await pool.query(
      `INSERT INTO sensor_readings (level, timestamp_raw, device_id, device_name)
       VALUES ($1, $2, $3, $4)`,
      [
        Number(level),
        String(timestamp),
        device_id || "ESP32_SIM",
        device_name || "POSTS-ESP32-01"
      ]
    );

    res.send("SUCCESS");
  } catch (err) {
    console.error(err);
    res.status(500).send("DB ERROR");
  }
});

const port = process.env.PORT || 10000;
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});