const express = require("express");
const { Pool } = require("pg");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS registered_sensors (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(50) UNIQUE NOT NULL,
        device_name VARCHAR(100) NOT NULL,
        location_name VARCHAR(150),
        latitude NUMERIC(10,6),
        longitude NUMERIC(10,6),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sensor_readings (
        id SERIAL PRIMARY KEY,
        water_level NUMERIC(5,2) NOT NULL,
        device_timestamp BIGINT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        device_id VARCHAR(50) NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sensor_readings_created_at
      ON sensor_readings(created_at DESC);

      CREATE TABLE IF NOT EXISTS alerts (
        id SERIAL PRIMARY KEY,
        reading_id INTEGER,
        level NUMERIC(5,2) NOT NULL,
        flood_status VARCHAR(20) NOT NULL,
        road_status VARCHAR(30) NOT NULL,
        message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_alerts_reading
          FOREIGN KEY (reading_id) REFERENCES sensor_readings(id)
          ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(60) UNIQUE NOT NULL,
        setting_value TEXT,
        description VARCHAR(255),
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await seedSettings();

    console.log("✅ Database initialized");
  } catch (err) {
    console.error("❌ DB INIT ERROR:", err);
  }
}

async function seedSettings() {
  const settings = [
    ["threshold_low", "1.00", "Level in ft below this is Low"],
    ["threshold_high", "3.00", "Level in ft above this is High"],
    ["tank_max_height", "6.00", "Max sensor range in feet"],
    ["refresh_interval", "15", "Dashboard auto-refresh in seconds"],
    ["alert_enabled", "1", "Enable alert logging 1=yes 0=no"],
    ["location_name", "San Simon, Pampanga", "Monitoring location name"],
    ["sensor_lat", "15.023205", "Sensor GPS latitude"],
    ["sensor_lng", "120.753861", "Sensor GPS longitude"]
  ];

  for (const [key, value, description] of settings) {
    await pool.query(
      `
      INSERT INTO settings (setting_key, setting_value, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (setting_key) DO NOTHING
      `,
      [key, value, description]
    );
  }
}

async function getThresholds() {
  const result = await pool.query(`
    SELECT setting_key, setting_value
    FROM settings
    WHERE setting_key IN ('threshold_low', 'threshold_high', 'alert_enabled')
  `);

  const map = {
    threshold_low: 1.0,
    threshold_high: 3.0,
    alert_enabled: "1"
  };

  for (const row of result.rows) {
    map[row.setting_key] = row.setting_value;
  }

  return {
    low: Number(map.threshold_low),
    high: Number(map.threshold_high),
    alertEnabled: String(map.alert_enabled) === "1"
  };
}

function buildAlert(level, low, high) {
  if (level >= high) {
    return {
      flood_status: "High",
      road_status: "Not Passable",
      message: `DANGER: Water level at ${level.toFixed(2)} ft. Roads not passable.`
    };
  }

  if (level >= low) {
    return {
      flood_status: "Moderate",
      road_status: "Use Caution",
      message: `WARNING: Water level at ${level.toFixed(2)} ft. Exercise caution.`
    };
  }

  return null;
}

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
      message: "Database connection failed",
      details: err.message
    });
  }
});

app.get("/api/latest", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, water_level, device_timestamp, created_at, device_id
      FROM sensor_readings
      ORDER BY id DESC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({
        status: "error",
        message: "No readings found"
      });
    }

    res.json({
      status: "success",
      data: result.rows[0]
    });
  } catch (err) {
    console.error("Latest reading error:", err);
    res.status(500).json({
      status: "error",
      message: "DB ERROR",
      details: err.message
    });
  }
});

app.post("/api/sensor", async (req, res) => {
  const client = await pool.connect();

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

    const waterLevel = Number(level);
    const deviceTimestamp = Number(timestamp);
    const deviceId = String(device_id).trim();
    const deviceName = String(device_name).trim();

    if (Number.isNaN(waterLevel)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid level value"
      });
    }

    if (Number.isNaN(deviceTimestamp)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid timestamp value"
      });
    }

    if (!deviceId || !deviceName) {
      return res.status(400).json({
        status: "error",
        message: "Invalid device_id or device_name"
      });
    }

    await client.query("BEGIN");

    await client.query(
      `
      INSERT INTO registered_sensors (device_id, device_name, is_active)
      VALUES ($1, $2, TRUE)
      ON CONFLICT (device_id)
      DO UPDATE SET device_name = EXCLUDED.device_name
      `,
      [deviceId, deviceName]
    );

    const sensorCheck = await client.query(
      `
      SELECT id, is_active
      FROM registered_sensors
      WHERE device_id = $1
      LIMIT 1
      `,
      [deviceId]
    );

    if (sensorCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        status: "error",
        message: "Device unregistered"
      });
    }

    if (sensorCheck.rows[0].is_active !== true) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        status: "error",
        message: "Device inactive"
      });
    }

    const insertReading = await client.query(
      `
      INSERT INTO sensor_readings (water_level, device_timestamp, device_id)
      VALUES ($1, $2, $3)
      RETURNING id, water_level, device_timestamp, created_at, device_id
      `,
      [waterLevel, deviceTimestamp, deviceId]
    );

    const reading = insertReading.rows[0];

    const thresholds = await getThresholds();
    if (thresholds.alertEnabled) {
      const alert = buildAlert(waterLevel, thresholds.low, thresholds.high);

      if (alert) {
        await client.query(
          `
          INSERT INTO alerts (reading_id, level, flood_status, road_status, message)
          VALUES ($1, $2, $3, $4, $5)
          `,
          [
            reading.id,
            waterLevel,
            alert.flood_status,
            alert.road_status,
            alert.message
          ]
        );
      }
    }

    await client.query("COMMIT");

    return res.status(200).json({
      status: "success",
      message: "Data saved",
      reading_id: reading.id,
      data: reading
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Insert error:", err);
    return res.status(500).json({
      status: "error",
      message: "DB ERROR",
      details: err.message
    });
  } finally {
    client.release();
  }
});

app.use((req, res) => {
  res.status(404).json({
    status: "error",
    message: "Route not found"
  });
});

const port = process.env.PORT || 10000;

app.listen(port, "0.0.0.0", async () => {
  console.log(`Server running on port ${port}`);
  await initDB();
});
