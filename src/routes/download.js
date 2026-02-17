const express = require('express');
const router = express.Router();
const db = require('../services/db');

// GET /api/download/:id — Download completed intake markdown
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const intake = await db.getIntakeBySessionId(id);
    if (!intake) {
      return res.status(404).json({ error: 'Intake not found or not yet complete' });
    }

    const clientName = (intake.client_name || 'Client').replace(/[^a-zA-Z0-9]/g, '-');
    const date = new Date(intake.created_at).toISOString().split('T')[0];
    const filename = `intake-${clientName}-${date}.md`;

    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(intake.markdown);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Failed to download intake' });
  }
});

module.exports = router;
