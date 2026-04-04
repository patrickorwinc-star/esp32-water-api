const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "*"
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* =========================
   HELPERS
========================= */
async function getSetting(key, fallback = null) {
  try {
    const result = await pool.query(
      `SELECT setting_value FROM settings WHERE setting_key = $1 LIMIT 1`,
      [key]
    );

    if (result.rows.length === 0) return fallback;
    return result.rows[0].setting_value;
  } catch (err) {
    console.error(`getSetting error for ${key}:`, err.message);
    return fallback;
  }
}

/* =========================
   INIT DATABASE
========================= */
async function initDB() {
  try {
    // sensor_readings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sensor_readings (
        id SERIAL PRIMARY KEY,
        water_level NUMERIC(5,2) NOT NULL,
        device_timestamp BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        device_id VARCHAR(100) NOT NULL DEFAULT ''
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sensor_readings_created_at
      ON sensor_readings(created_at);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sensor_readings_device_id_timestamp
      ON sensor_readings(device_id, device_timestamp);
    `);

    // alerts
    await pool.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        reading_id INTEGER REFERENCES sensor_readings(id) ON DELETE SET NULL,
        level NUMERIC(5,2) NOT NULL,
        flood_status VARCHAR(20) NOT NULL,
        road_status VARCHAR(30) NOT NULL,
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // registered_sensors
    await pool.query(`
      CREATE TABLE IF NOT EXISTS registered_sensors (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        device_id VARCHAR(100) NOT NULL UNIQUE,
        road_name VARCHAR(150) NOT NULL DEFAULT '',
        lat NUMERIC(10,6) NOT NULL DEFAULT 0,
        lng NUMERIC(10,6) NOT NULL DEFAULT 0,
        description VARCHAR(255) NOT NULL DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // settings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(100) NOT NULL UNIQUE,
        setting_value TEXT NOT NULL,
        description TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // seed settings
    await pool.query(`
      INSERT INTO settings (setting_key, setting_value, description)
      VALUES
        ('threshold_low', '1.00', 'Level in ft below this is Low'),
        ('threshold_high', '2', 'Level in ft above this is High'),
        ('tank_max_height', '4.2', 'Max sensor range in feet'),
        ('refresh_interval', '15', 'Dashboard auto-refresh in seconds'),
        ('alert_enabled', '1', 'Enable alert logging 1=yes 0=no'),
        ('location_name', 'San Simon, Pampanga', 'Monitoring location name'),
        ('sensor_lat', '15.023205', 'Sensor GPS latitude'),
        ('sensor_lng', '120.753861', 'Sensor GPS longitude')
      ON CONFLICT (setting_key) DO NOTHING;
    `);

    console.log("✅ PostgreSQL tables are ready");
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

// Latest data
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

// History
app.get("/api/history", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10), 500));

    const result = await pool.query(`
      SELECT * FROM sensor_readings
      ORDER BY id DESC
      LIMIT $1
    `, [limit]);

    res.json({
      status: "success",
      count: result.rows.length,
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

// Stats
app.get("/api/stats", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) AS total_readings,
        MIN(water_level) AS min_level,
        MAX(water_level) AS max_level,
        AVG(water_level) AS avg_level,
        MAX(created_at) AS last_reading
      FROM sensor_readings
    `);

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

// Alerts history
app.get("/api/alerts", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10), 500));

    const result = await pool.query(`
      SELECT * FROM alerts
      ORDER BY id DESC
      LIMIT $1
    `, [limit]);

    res.json({
      status: "success",
      count: result.rows.length,
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

// Sensors list
app.get("/api/sensors", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM registered_sensors
      ORDER BY id DESC
    `);

    res.json({
      status: "success",
      count: result.rows.length,
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
    const { level, timestamp, device_id, device_name } = req.body;

    if (level === undefined || timestamp === undefined || !device_id) {
      return res.status(400).json({
        status: "error",
        message: "Missing fields"
      });
    }

    const levelNum = Number(level);
    const timeNum = Number(timestamp);

    if (!Number.isFinite(levelNum) || levelNum <= 0 || levelNum > 100) {
      return res.status(400).json({
        status: "error",
        message: "Invalid level"
      });
    }

    if (!Number.isFinite(timeNum) || timeNum <= 0) {
      return res.status(400).json({
        status: "error",
        message: "Invalid timestamp"
      });
    }

    // check registered sensor
    const sensorCheck = await pool.query(
      `SELECT id, name, road_name, lat, lng, description, status
       FROM registered_sensors
       WHERE device_id = $1 AND status = 'active'
       LIMIT 1`,
      [device_id]
    );

    if (sensorCheck.rows.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "Unregistered device",
        device_id
      });
    }

    // duplicate protection
    const dupCheck = await pool.query(
      `SELECT id, water_level, device_timestamp, device_id, created_at
       FROM sensor_readings
       WHERE device_id = $1 AND device_timestamp = $2
       LIMIT 1`,
      [device_id, timeNum]
    );

    if (dupCheck.rows.length > 0) {
      return res.json({
        status: "success",
        message: "Duplicate skipped",
        data: dupCheck.rows[0],
        sensor: sensorCheck.rows[0]
      });
    }

    // insert reading
    const insertReading = await pool.query(
      `INSERT INTO sensor_readings (water_level, device_timestamp, device_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [levelNum, timeNum, device_id]
    );

    const reading = insertReading.rows[0];

    // thresholds/settings
    const thresholdLow = Number(await getSetting("threshold_low", "1.0"));
    const thresholdHigh = Number(await getSetting("threshold_high", "2.0"));
    const alertEnabled = String(await getSetting("alert_enabled", "1")) === "1";

    let alertData = null;

    if (alertEnabled && levelNum >= thresholdLow) {
      let floodStatus = "Moderate";
      let roadStatus = "Use Caution";
      let message = `WARNING: Water level at ${levelNum} ft. Exercise caution.`;

      if (levelNum >= thresholdHigh) {
        floodStatus = "High";
        roadStatus = "Not Passable";
        message = `DANGER: Water level at ${levelNum} ft. Roads not passable.`;
      }

      const alertInsert = await pool.query(
        `INSERT INTO alerts (reading_id, level, flood_status, road_status, message)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [reading.id, levelNum, floodStatus, roadStatus, message]
      );

      alertData = alertInsert.rows[0];
    }

    res.json({
      status: "success",
      message: "Data saved",
      data: reading,
      sensor: sensorCheck.rows[0],
      alert: alertData,
      received_name: device_name || null
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

// register sensor manually
app.post("/api/sensors", async (req, res) => {
  try {
    const {
      name,
      device_id,
      road_name = "",
      lat = 0,
      lng = 0,
      description = "",
      status = "active"
    } = req.body;

    if (!name || !device_id) {
      return res.status(400).json({
        status: "error",
        message: "Missing name or device_id"
      });
    }

    const result = await pool.query(
      `INSERT INTO registered_sensors
       (name, device_id, road_name, lat, lng, description, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (device_id)
       DO UPDATE SET
         name = EXCLUDED.name,
         road_name = EXCLUDED.road_name,
         lat = EXCLUDED.lat,
         lng = EXCLUDED.lng,
         description = EXCLUDED.description,
         status = EXCLUDED.status
       RETURNING *`,
      [name, device_id, road_name, Number(lat), Number(lng), description, status]
    );

    res.json({
      status: "success",
      message: "Sensor saved",
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

// settings
app.get("/api/settings", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT setting_key, setting_value, description, updated_at
      FROM settings
      ORDER BY setting_key ASC
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
