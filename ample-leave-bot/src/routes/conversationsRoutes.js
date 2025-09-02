import { Router } from 'express';
import { pool, requireAdmin } from '../db.js';
import PDFDocument from 'pdfkit';
import { format as formatDate } from 'date-fns';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

// IMPLEMENTED: Sessions listing per user/email
// GET /admin/sessions?user_id=&email=&channel_id=&from=&to=
router.get('/admin/sessions', requireAdmin, async (req, res) => {
  try {
    const { user_id, email, channel_id, from, to } = req.query;
    let uid = user_id;
    if (!uid && email) {
      const u = await pool.query('select id from users where email=$1 limit 1', [email]);
      if (u.rows[0]) uid = u.rows[0].id;
    }
    if (!uid && !channel_id) return res.json([]);

    const params = [];
    let where = [];
    if (uid) { params.push(uid); where.push(`user_id = $${params.length}`); }
    if (channel_id) { params.push(channel_id); where.push(`channel_id = $${params.length}`); }
    if (from) { params.push(from); where.push(`last_activity_at >= $${params.length}`); }
    if (to) { params.push(to); where.push(`last_activity_at <= $${params.length}`); }
    const whereSql = where.length ? 'where ' + where.join(' and ') : '';

    const { rows } = await pool.query(
      `select id, team_id, channel_id, user_id, thread_ts, started_at, last_activity_at
       from sessions
       ${whereSql}
       order by last_activity_at desc
       limit 100`, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'failed_to_list_sessions', detail: e.message });
  }
});

// IMPLEMENTED: Messages by session with keyset pagination
// GET /admin/messages?session_id=&before=&limit=
router.get('/admin/messages', requireAdmin, async (req, res) => {
  try {
    const { session_id, before, limit = '50' } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });
    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const params = [session_id];
    let where = 'where session_id = $1';
    if (before) { params.push(before); where += ` and created_at < $${params.length}`; }
    const { rows } = await pool.query(
      `select id, role, content, created_at, model, prompt_tokens, completion_tokens, latency_ms
       from messages
       ${where}
       order by created_at desc
       limit ${lim}`, params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'failed_to_list_messages', detail: e.message });
  }
});

// IMPLEMENTED: Merge last N sessions and return a single timeline
// GET /admin/conversations/merged?email=&limit=&before=&sessions=
router.get('/admin/conversations/merged', requireAdmin, async (req, res) => {
  try {
    const { email, limit = '100', before, sessions = '5' } = req.query;
    if (!email) return res.status(400).json({ error: 'email required' });

    // Resolve user id
    const u = await pool.query('select id from users where email=$1 limit 1', [email]);
    if (!u.rows[0]) return res.json({ messages: [], has_more: false, next_cursor: null });
    const userId = u.rows[0].id;

    // Get last N sessions for the user
    const sesCount = Math.min(Math.max(parseInt(sessions, 10) || 5, 1), 20);
    const sesRes = await pool.query(
      `select id from sessions where user_id=$1 order by last_activity_at desc limit $2`,
      [userId, sesCount]
    );
    const sessionIds = sesRes.rows.map(r => r.id);
    if (sessionIds.length === 0) {
      return res.json({ messages: [], has_more: false, next_cursor: null });
    }

    const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const params = [sessionIds];
    let idx = 2;
    let where = `where m.session_id = any($1::uuid[])`;
    if (before) { params.push(before); where += ` and m.created_at < $${idx++}`; }
    params.push(lim);

    const q = `
      select m.id, m.role, m.content, m.created_at, m.model, m.prompt_tokens, m.completion_tokens,
             m.latency_ms, m.session_id, s.channel_id
      from messages m
      join sessions s on s.id = m.session_id
      ${where}
      order by m.created_at desc
      limit $${idx}
    `;
    const { rows } = await pool.query(q, params);
    const hasMore = rows.length === lim;
    const nextCursor = hasMore ? rows[rows.length - 1].created_at : null;
    res.json({ messages: rows, has_more: hasMore, next_cursor: nextCursor });
  } catch (e) {
    res.status(500).json({ error: 'failed_to_merge_conversations', detail: e.message });
  }
});

// Helper function to generate PDF
function generatePDF(conversations, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // PDF Header
      doc.fontSize(16).font('Helvetica-Bold');
      doc.text('Conversation Export Report', { align: 'center' });
      doc.moveDown();
      
      // Report metadata
      doc.fontSize(10).font('Helvetica');
      if (options.email) doc.text(`User: ${options.email}`);
      if (options.from) doc.text(`From: ${options.from}`);
      if (options.to) doc.text(`To: ${options.to}`);
      doc.text(`Generated: ${formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss')}`);
      doc.text(`Total Messages: ${conversations.length}`);
      doc.moveDown();

      // Conversations
      conversations.forEach((msg, index) => {
        if (doc.y > doc.page.height - 100) {
          doc.addPage();
        }

        doc.fontSize(8).font('Helvetica-Bold');
        const timeStr = options.includeTimestamps && msg.created_at 
          ? formatDate(new Date(msg.created_at), 'yyyy-MM-dd HH:mm:ss')
          : '';
        // Use email for user role, keep assistant as is
        const displayRole = msg.role === 'user' ? (msg.email || 'user') : msg.role;
        const roleText = `${displayRole.toUpperCase()}${timeStr ? ` (${timeStr})` : ''}`;
        doc.text(roleText);

        if (options.includeSessionInfo && msg.session_id) {
          doc.fontSize(7).font('Helvetica');
          doc.text(`Session: ${msg.session_id}${msg.channel_id ? ` | Channel: ${msg.channel_id}` : ''}`);
        }

        if (options.includeContent && msg.content) {
          doc.fontSize(9).font('Helvetica');
          doc.text(msg.content, { width: doc.page.width - 100 });
        }

        if (msg.model && (msg.prompt_tokens || msg.completion_tokens)) {
          doc.fontSize(7).font('Helvetica');
          doc.text(`Model: ${msg.model} | Tokens: ${msg.prompt_tokens || 0}/${msg.completion_tokens || 0}${msg.latency_ms ? ` | ${msg.latency_ms}ms` : ''}`);
        }

        doc.moveDown(0.5);
      });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// Helper function to generate CSV
function generateCSV(conversations, options = {}) {
  const headers = ['role'];
  if (options.includeTimestamps) headers.push('timestamp');
  if (options.includeContent) headers.push('content');
  if (options.includeSessionInfo) {
    headers.push('session_id', 'channel_id');
  }
  headers.push('model', 'prompt_tokens', 'completion_tokens', 'latency_ms');

  const csvRows = [headers.join(',')];
  
  conversations.forEach(msg => {
    const row = [];
    // Use email for user role, keep assistant as is
    const displayRole = msg.role === 'user' ? (msg.email || 'user') : msg.role;
    row.push(`"${displayRole}"`);
    
    if (options.includeTimestamps) {
      row.push(`"${msg.created_at || ''}"`);
    }
    
    if (options.includeContent) {
      const content = (msg.content || '').replace(/"/g, '""');
      row.push(`"${content}"`);
    }
    
    if (options.includeSessionInfo) {
      row.push(`"${msg.session_id || ''}"`);
      row.push(`"${msg.channel_id || ''}"`);
    }
    
    row.push(`"${msg.model || ''}"`);
    row.push(msg.prompt_tokens || 0);
    row.push(msg.completion_tokens || 0);
    row.push(msg.latency_ms || 0);
    
    csvRows.push(row.join(','));
  });

  return csvRows.join('\n');
}

// IMPLEMENTED: Export conversations in multiple formats (individual and bulk)
// GET /admin/conversations/export?email=&format=&from=&to=&includeContent=&includeTimestamps=&includeSessionInfo=&includeRagSources=&bulk=
router.get('/admin/conversations/export', requireAdmin, async (req, res) => {
  try {
    const { 
      email, 
      format = 'json', 
      from, 
      to, 
      includeContent = 'true',
      includeTimestamps = 'true', 
      includeSessionInfo = 'false',
      includeRagSources = 'false',
      bulk = 'false'
    } = req.query;

    const isBulkExport = bulk === 'true';

    if (!isBulkExport && !email) {
      return res.status(400).json({ error: 'email parameter is required for individual exports' });
    }

    if (!['pdf', 'csv', 'json'].includes(format.toLowerCase())) {
      return res.status(400).json({ error: 'format must be pdf, csv, or json' });
    }

    // Build query to get conversations
    const params = [];
    let whereClause = '';
    
    if (!isBulkExport) {
      // Individual export - get specific user
      const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ error: 'user not found' });
      }
      const userId = userResult.rows[0].id;
      params.push(userId);
      whereClause = 'WHERE m.user_id = $1';
    } else {
      // Bulk export - get all users
      whereClause = 'WHERE 1=1';
    }
    
    if (from) {
      params.push(from + ' 00:00:00');
      whereClause += ` AND m.created_at >= $${params.length}`;
    }
    
    if (to) {
      params.push(to + ' 23:59:59');
      whereClause += ` AND m.created_at <= $${params.length}`;
    }

    const query = `
      SELECT 
        m.id,
        m.role,
        ${includeContent === 'true' ? 'm.content,' : 'NULL as content,'}
        m.created_at,
        m.model,
        m.prompt_tokens,
        m.completion_tokens,
        m.latency_ms,
        ${includeSessionInfo === 'true' ? 'm.session_id, s.channel_id,' : 'NULL as session_id, NULL as channel_id,'}
        u.email
      FROM messages m
      LEFT JOIN sessions s ON s.id = m.session_id
      LEFT JOIN users u ON u.id = m.user_id
      ${whereClause}
      ORDER BY m.created_at ASC
    `;

    const result = await pool.query(query, params);
    const conversations = result.rows;

    if (conversations.length === 0) {
      return res.status(404).json({ error: 'no conversations found for the specified criteria' });
    }

    // Generate filename
    const dateStr = formatDate(new Date(), 'yyyyMMdd-HHmmss');
    const filename = isBulkExport 
      ? `all_employees_conversations_${dateStr}.${format}`
      : `conversations-${email.split('@')[0]}-${dateStr}.${format}`;

    const options = {
      email: isBulkExport ? 'all_employees' : email,
      from,
      to,
      includeContent: includeContent === 'true',
      includeTimestamps: includeTimestamps === 'true',
      includeSessionInfo: includeSessionInfo === 'true',
      includeRagSources: includeRagSources === 'true',
      isBulkExport
    };

    // Generate and return file based on format
    switch (format.toLowerCase()) {
      case 'pdf':
        const pdfBuffer = await generatePDF(conversations, options);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);
        break;

      case 'csv':
        const csvData = generateCSV(conversations, options);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvData);
        break;

      case 'json':
        // Transform conversations to use email for user role
        const transformedConversations = conversations.map(msg => ({
          ...msg,
          role: msg.role === 'user' ? (msg.email || 'user') : msg.role
        }));
        
        const jsonData = {
          export_info: {
            email: isBulkExport ? 'all_employees' : email,
            generated_at: new Date().toISOString(),
            date_range: { from, to },
            total_messages: conversations.length,
            options
          },
          conversations: transformedConversations
        };
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json(jsonData);
        break;
    }

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ 
      error: 'export failed', 
      detail: error.message 
    });
  }
});

export default router;


