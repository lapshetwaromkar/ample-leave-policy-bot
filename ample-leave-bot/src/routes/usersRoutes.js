import { Router } from 'express';
import { pool, requireAdmin } from '../db.js';

const router = Router();

// IMPLEMENTED: Users list with email-first search and pagination
// GET /admin/users?search=&country_code=&role=&status=&from=&to=&page=&limit=
router.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const { search = '', country_code, role, status, from, to, page = '1', limit = '50' } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const off = (pageNum - 1) * lim;

    const params = [];
    const where = [];
    if (search) {
      params.push(`${search}%`, `%${search}%`);
      where.push('(email ilike $' + (params.length - 1) + ' or display_name ilike $' + params.length + ')');
    }
    // country_code/role/status placeholders (not tracked yet in users) – ignored for now
    const whereSql = where.length ? 'where ' + where.join(' and ') : '';

    const sql = `
      select email, first_name, last_name, display_name, real_name, timezone, locale,
             last_seen_at,
             (select count(*) from messages m where m.user_id = u.id) as messages_count
      from users u
      ${whereSql}
      order by last_seen_at desc nulls last
      limit ${lim} offset ${off}
    `;
    const { rows } = await pool.query(sql, params);

    res.json({ page: pageNum, limit: lim, results: rows });
  } catch (e) {
    res.status(500).json({ error: 'failed_to_list_users', detail: e.message });
  }
});

export default router;


