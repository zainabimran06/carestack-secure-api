require('dotenv').config();
const express = require('express');
const { pool, ping } = require('./db');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

app.get('/health', async (_req, res) => {
  try {
    await ping();
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error', detail: err.message });
  }
});

  app.get('/patients', async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT PatientID, FirstName, LastName, DOB, Phone FROM PATIENT ORDER BY PatientID LIMIT 100'
    );
    res.json(rows);
  } catch (err) { next(err); }
});
app.get('/appointments', async (_req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.AppointmentID, CONCAT(s.FirstName, " ", s.LastName) AS DoctorName,
              CONCAT(p.FirstName, " ", p.LastName) AS PatientName,
              a.AppointmentDate, a.Status
       FROM APPOINTMENT a
       JOIN DOCTOR d ON a.DoctorID = d.DoctorID
       JOIN STAFF s ON d.StaffID = s.StaffID
       JOIN PATIENT p ON a.PatientID = p.PatientID
       ORDER BY a.AppointmentDate DESC LIMIT 100`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

app.post('/appointments', async (req, res, next) => {
  const { patient_id, doctor_id, appointment_date, notes } = req.body;
  if (!patient_id || !doctor_id || !appointment_date) {
    return res.status(400).json({ error: 'patient_id, doctor_id, and appointment_date are required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.query(
      'CALL sp_BookAppointment(?, ?, ?, ?, @id, @msg)',
      [patient_id, doctor_id, appointment_date, notes || null]
    );
    const [[result]] = await conn.query('SELECT @id AS appointmentId, @msg AS message');

    if (result.appointmentId === null) {
      return res.status(409).json({ error: result.message });
    }
    res.status(201).json({ appointmentId: result.appointmentId, message: result.message });
  } catch (err) {
    next(err);
  } finally {
    conn.release();
  }
});
app.get('/billing/:patientId', async (_req, res, next) => {
  try {
    const { patientId } = _req.params;
    const [rows] = await pool.query(
      'SELECT * FROM BILLING WHERE PatientID = ?',
      [patientId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

app.listen(PORT, () => console.log(`>>> BUILD-CHECK-42 <<< listening on port ${PORT}`));
