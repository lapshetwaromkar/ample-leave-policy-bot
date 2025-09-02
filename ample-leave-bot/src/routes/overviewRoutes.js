import { Router } from 'express';
import { requireAdmin } from '../db.js';

const router = Router();

// NOT IMPLEMENTED YET: Overview cards
// GET /admin/overview?from=&to=
router.get('/admin/overview', requireAdmin, async (req, res) => {
  const { from, to } = req.query;
  res.status(501).json({
    ok: false,
    message: 'Not implemented',
    endpoint: 'GET /admin/overview',
    expected_query: { from: 'ISO string', to: 'ISO string' },
    received_query: { from, to }
  });
});

// NOT IMPLEMENTED YET: Timeseries trends
// GET /admin/trends?from=&to=
router.get('/admin/trends', requireAdmin, async (req, res) => {
  const { from, to } = req.query;
  res.status(501).json({
    ok: false,
    message: 'Not implemented',
    endpoint: 'GET /admin/trends',
    expected_query: { from: 'ISO string', to: 'ISO string' },
    received_query: { from, to }
  });
});

export default router;


