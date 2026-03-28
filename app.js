const express = require("express");
const mysql = require("mysql2/promise");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10
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

    await pool.execute(
      `INSERT INTO sensor_readings (water_level, timestamp_unix, created_at, device_id)
       VALUES (?, ?, NOW(), ?)`,
      [
        Number(level),
        Number(timestamp),
        device_id || "ESP32_SIM"
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
