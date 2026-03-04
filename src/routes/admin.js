const express = require('express');
const router = express.Router();
const { getSession, listAllSessions } = require('../services/session-manager');

function requireAdmin(req, res, next) {
  const token = req.cookies?.admin_token;
  if (!token || token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    res.cookie('admin_token', password, { httpOnly: true, path: '/api/admin' });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid password' });
});

router.get('/sessions', requireAdmin, async (req, res) => {
  const sessions = await listAllSessions();
  res.json({
    sessions: sessions.map(s => {
      let status = 'Started';
      if (s.is_complete) status = 'Complete';
      else if (s.turn_count > 0) status = 'Abandoned';
      return {
        id: s.id,
        client_name: s.client_name,
        created_at: s.created_at,
        completed_at: s.completed_at,
        turn_count: s.turn_count,
        status
      };
    })
  });
});

router.get('/sessions/:id', requireAdmin, async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
});

router.get('/sessions/:id/download', requireAdmin, async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  if (!session.markdown) {
    return res.status(400).json({ error: 'No PRP generated' });
  }
  const date = new Date(session.completed_at || Date.now()).toISOString().split('T')[0];
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="intake-${session.client_name || 'client'}-${date}.md"`);
  res.send(session.markdown);
});

module.exports = router;
