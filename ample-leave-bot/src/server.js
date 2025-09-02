import express from 'express';
import { parseAllPolicyDocs } from './documentParser.js';
import { answerPolicyQuestion } from './policyQA.js';
import dotenv from 'dotenv';
import { pool, ensureSchema, requireAdmin } from './db.js';
import overviewRoutes from './routes/overviewRoutes.js';
import usersRoutes from './routes/usersRoutes.js';
import conversationsRoutes from './routes/conversationsRoutes.js';
import documentsRoutes from './routes/documentsRoutes.js';
import cors from 'cors';
import path from 'path';
import { upsertDocument, searchSimilar, processIndividualFiles } from './rag.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Enable CORS for frontend dev
app.use(cors({
  origin: process.env.CORS_ORIGIN || true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','x-admin-token'],
  credentials: false
}));
// Ensure preflight requests are handled
app.options('*', cors({
  origin: process.env.CORS_ORIGIN || true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','x-admin-token'],
  credentials: false
}));

// Optional request logger for debugging frontend calls
if (process.env.REQUEST_LOG === 'true') {
  app.use('/admin', (req, res, next) => {
    const token = req.headers['x-admin-token'] || '';
    const masked = token ? `${String(token).slice(0, 4)}***` : 'none';
    console.log('ADMIN REQUEST', {
      method: req.method,
      path: req.path,
      query: req.query,
      origin: req.headers.origin || null,
      referer: req.headers.referer || null,
      userAgent: req.headers['user-agent'] || null,
      hasToken: !!token,
      tokenMasked: masked
    });
    next();
  });
}
// Do not expose entire repo in prod; optionally serve only test page
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static('.'));
}

let policyContext = '';
const USE_RAG = process.env.USE_RAG === 'true';

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    policyLoaded: policyContext.length > 0
  });
});

// Root status to match README/tests shape
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    ready: policyContext.length > 0,
    policyTextLength: policyContext.length
  });
});

app.post('/ask', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    console.log(`Question received: ${question}`);
    
    let contextForLLM = policyContext;
    if (USE_RAG) {
      const resolvedCountry = process.env.DEFAULT_COUNTRY || null; // simple default; Slack resolver lives in slack bot
      const hits = await searchSimilar({ query: question, countryCode: resolvedCountry });
      console.log(`🔍 RAG Search Results: ${hits.length} chunks found`);
      console.log(`🔍 RAG Chunks:`, hits.map(h => ({ 
        id: h.id, 
        similarity: h.similarity?.toFixed(4), 
        contentPreview: h.content.substring(0, 100) + '...' 
      })));
      
      const joined = hits.map(h => h.content).join('\n\n');
      console.log(`🔍 RAG Context Length: ${joined.length} characters`);
      console.log(`🔍 Fallback Context Length: ${policyContext.length} characters`);
      
      contextForLLM = joined || policyContext; // fallback
    }

    const { text, usage } = await answerPolicyQuestion(question, contextForLLM);
    console.log(`Answer generated: ${text.substring(0, 100)}...`);
    
    res.json({ answer: text, usage });
  } catch (error) {
    console.error('Error processing question:', error);
    res.status(500).json({ error: 'Failed to process question' });
  }
});

// Mount admin routes (stubs for now)
app.use(overviewRoutes);
app.use(usersRoutes);
app.use(conversationsRoutes);
app.use(documentsRoutes);

// IMPLEMENTED: SSE stream for real-time messages per session
app.get('/admin/stream/messages', requireAdmin, async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const listener = (msg) => {
    if (msg.sessionId === session_id) {
      try { res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch {}
    }
  };
  globalThis.__msgBus = globalThis.__msgBus || new Set();
  globalThis.__msgBus.add(listener);
  req.on('close', () => {
    try { globalThis.__msgBus.delete(listener); } catch {}
  });
});

// Admin endpoints for dashboard
app.get('/admin/messages', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const result = await pool.query(
      `select m.created_at, m.role, m.content, m.team_id, m.channel_id, m.thread_ts,
              m.model, m.prompt_tokens, m.completion_tokens, m.latency_ms,
              u.email, u.first_name, u.last_name, u.display_name
       from messages m
       left join users u on u.id = m.user_id
       order by m.created_at desc
       limit $1`,
      [limit]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'failed_to_fetch_messages' });
  }
});

app.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `select created_at, last_seen_at, email, first_name, last_name, display_name, team_id, slack_user_id
       from users order by last_seen_at desc nulls last limit 200`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'failed_to_fetch_users' });
  }
});

// Load policy documents on startup
console.log('Initializing database schema...');
ensureSchema()
  .then(() => {
    console.log('Loading policy documents...');
    return parseAllPolicyDocs();
  })
  .then(context => {
    policyContext = context;
    console.log(`Loaded ${context.length} characters from policy documents`);
    if (USE_RAG && process.env.RAG_REBUILD_ON_START === 'true') {
      console.log('Building vector store from individual documents (RAG_REBUILD_ON_START=true)...');
      const docsDir = path.join(import.meta.dirname, '../docs');
      const country = process.env.DEFAULT_COUNTRY || 'IN';
      return processIndividualFiles(docsDir, country);
    }
    return null;
  })
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Ample Leave Policy Bot server running on port ${PORT}`);
      console.log('📄 Place your policy PDF files in the /docs folder');
      console.log('🔑 Make sure to set your OPENAI_API_KEY in the .env file');
      console.log('💬 Test with: POST http://localhost:3000/ask');
      console.log('🌐 Test Interface: http://localhost:3000/test');
    });
  })
  .catch(error => {
    console.error('Startup failure:', error);
    process.exit(1);
  });