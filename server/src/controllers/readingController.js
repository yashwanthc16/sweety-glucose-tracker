const db = require('../config/db');

const VALID_SLOTS = [
  'Morning (fasting)',
  'After breakfast',
  'After lunch',
  'After dinner',
];

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function validateReadingFields({ date, slot, value }) {
  // 1. Value is required
  if (value === undefined || value === null || String(value).trim() === '') {
    return 'Please enter a glucose value.';
  }

  // 2. Value must be a whole number between 40 and 600
  const numValue = Number(value);
  if (!Number.isInteger(numValue) || numValue < 40 || numValue > 600) {
    return 'Value must be between 40 and 600 mg/dl.';
  }

  // 3. Valid slot check
  if (!VALID_SLOTS.includes(slot)) {
    return 'Please select a valid time slot.';
  }

  // 4. Date cannot be in the future
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return 'Please enter a valid date.';
  }
  if (date > getTodayDateString()) {
    return 'Date cannot be in the future.';
  }

  return null;
}

// GET /api/readings
async function getReadings(req, res) {
  try {
    const userId = req.user.userId;
    const { date } = req.query;

    let queryText = `
      SELECT id, TO_CHAR(reading_date, 'YYYY-MM-DD') AS date, slot, value, created_at
      FROM readings
      WHERE user_id = $1
    `;
    const params = [userId];

    if (date) {
      queryText += ` AND reading_date = $2`;
      params.push(date);
    }

    queryText += `
      ORDER BY reading_date DESC,
      CASE slot
        WHEN 'Morning (fasting)' THEN 1
        WHEN 'After breakfast' THEN 2
        WHEN 'After lunch' THEN 3
        WHEN 'After dinner' THEN 4
      END ASC
    `;

    const result = await db.query(queryText, params);
    return res.json({ readings: result.rows });
  } catch (err) {
    console.error('Get readings error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// POST /api/readings
async function createReading(req, res) {
  try {
    const userId = req.user.userId;
    const { date, slot, value } = req.body;

    const validationError = validateReadingFields({ date, slot, value });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // Check existing readings for this user on this date
    const existingRes = await db.query(
      'SELECT id, slot FROM readings WHERE user_id = $1 AND reading_date = $2',
      [userId, date]
    );

    if (existingRes.rows.length >= 4) {
      return res.status(400).json({ error: 'You can add only 4 readings per day.' });
    }

    const duplicateSlot = existingRes.rows.find((row) => row.slot === slot);
    if (duplicateSlot) {
      return res.status(400).json({ error: `You already have an ${slot} reading for this date.` });
    }

    const insertRes = await db.query(
      `INSERT INTO readings (user_id, reading_date, slot, value)
       VALUES ($1, $2, $3, $4)
       RETURNING id, TO_CHAR(reading_date, 'YYYY-MM-DD') AS date, slot, value`,
      [userId, date, slot, Number(value)]
    );

    return res.status(201).json({ reading: insertRes.rows[0] });
  } catch (err) {
    console.error('Create reading error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// PUT /api/readings/:id
async function updateReading(req, res) {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { date, slot, value } = req.body;

    const validationError = validateReadingFields({ date, slot, value });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // Ensure reading belongs to authenticated user
    const currentRes = await db.query(
      'SELECT id FROM readings WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (currentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Reading not found.' });
    }

    // Check other readings on the target date (excluding current reading)
    const otherRes = await db.query(
      'SELECT id, slot FROM readings WHERE user_id = $1 AND reading_date = $2 AND id != $3',
      [userId, date, id]
    );

    if (otherRes.rows.length >= 4) {
      return res.status(400).json({ error: 'You can add only 4 readings per day.' });
    }

    const duplicateSlot = otherRes.rows.find((row) => row.slot === slot);
    if (duplicateSlot) {
      return res.status(400).json({ error: `You already have an ${slot} reading for this date.` });
    }

    const updateRes = await db.query(
      `UPDATE readings
       SET reading_date = $1, slot = $2, value = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 AND user_id = $5
       RETURNING id, TO_CHAR(reading_date, 'YYYY-MM-DD') AS date, slot, value`,
      [date, slot, Number(value), id, userId]
    );

    return res.json({ reading: updateRes.rows[0] });
  } catch (err) {
    console.error('Update reading error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

// DELETE /api/readings/:id
async function deleteReading(req, res) {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const deleteRes = await db.query(
      'DELETE FROM readings WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (deleteRes.rows.length === 0) {
      return res.status(404).json({ error: 'Reading not found.' });
    }

    return res.json({ message: 'Reading deleted successfully.' });
  } catch (err) {
    console.error('Delete reading error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}

module.exports = { getReadings, createReading, updateReading, deleteReading };