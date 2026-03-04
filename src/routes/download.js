const express = require('express');
const router = express.Router();
const { getSession } = require('../services/session-manager');
const { buildMarkdown } = require('../services/markdown-builder');

router.get('/:id', async (req, res) => {
  const session = await getSession(req.params.id);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (!session.is_complete) {
    return res.status(400).json({ error: 'Session not complete' });
  }

  const markdown = session.markdown || buildMarkdown(session);
  const date = new Date().toISOString().split('T')[0];
  const filename = `project-intake-${date}.md`;

  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(markdown);
});

module.exports = router;
