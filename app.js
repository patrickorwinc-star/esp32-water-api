app.post("/api/sensor", async (req, res) => {
  try {
    const { level, timestamp, device_id, device_name } = req.body;

    if (level === undefined || timestamp === undefined || !device_id || !device_name) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields"
      });
    }

    await pool.query(
      `INSERT INTO sensor_readings (level, timestamp_raw, device_id, device_name)
       VALUES ($1, $2, $3, $4)`,
      [
        Number(level),
        String(timestamp),
        device_id,
        device_name
      ]
    );

    res.json({
      status: "success",
      message: "Data saved"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "error",
      message: "DB ERROR"
    });
  }
});
