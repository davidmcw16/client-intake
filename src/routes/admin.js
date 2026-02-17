const express = require('express');
const router = express.Router();
const db = require('../services/db');

// Auth middleware
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.slice(7);
  if (token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  next();
}

router.use(requireAuth);

// GET /api/admin/intakes — List all intakes
router.get('/intakes', async (req, res) => {
  try {
    const intakes = await db.getAllIntakes();
    const mapped = intakes.map(i => ({
      ...i,
      duration_minutes: i.duration_ms ? Math.round(i.duration_ms / 60000) : null
    }));
    res.json({ intakes: mapped });
  } catch (err) {
    console.error('Admin list error:', err);
    res.status(500).json({ error: 'Failed to fetch intakes' });
  }
});

// GET /api/admin/intakes/:id/markdown — Download specific intake
router.get('/intakes/:id/markdown', async (req, res) => {
  try {
    const intake = await db.getIntakeById(req.params.id);
    if (!intake) return res.status(404).json({ error: 'Intake not found' });

    const clientName = (intake.client_name || 'Client').replace(/[^a-zA-Z0-9]/g, '-');
    const date = new Date(intake.created_at).toISOString().split('T')[0];

    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="intake-${clientName}-${date}.md"`);
    res.send(intake.markdown);
  } catch (err) {
    console.error('Admin download error:', err);
    res.status(500).json({ error: 'Failed to download' });
  }
});

// DELETE /api/admin/intakes/:id — Delete an intake
router.delete('/intakes/:id', async (req, res) => {
  try {
    const deleted = await db.deleteIntake(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Intake not found' });
    res.json({ deleted: true });
  } catch (err) {
    console.error('Admin delete error:', err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

module.exports = router;
