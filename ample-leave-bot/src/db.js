import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
});

export async function ensureSchema() {
  const ddl = `
    create extension if not exists pgcrypto;
    ${process.env.USE_RAG === 'true' ? 'create extension if not exists vector;' : ''}

    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      team_id text not null,
      slack_user_id text not null unique,
      email text,
      first_name text,
      last_name text,
      display_name text,
      real_name text,
      avatar_url text,
      timezone text,
      locale text,
      is_bot boolean default false,
      is_app_user boolean default false,
      last_seen_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists sessions (
      id uuid primary key default gen_random_uuid(),
      team_id text not null,
      channel_id text not null,
      user_id uuid not null references users(id) on delete cascade,
      thread_ts text,
      started_at timestamptz not null default now(),
      ended_at timestamptz,
      title text,
      last_activity_at timestamptz not null default now()
    );

    create table if not exists messages (
      id uuid primary key default gen_random_uuid(),
      team_id text not null,
      channel_id text not null,
      user_id uuid references users(id) on delete set null,
      session_id uuid references sessions(id) on delete set null,
      role text not null check (role in ('user','assistant','system')),
      content text not null,
      slack_ts text,
      thread_ts text,
      model text,
      prompt_tokens int,
      completion_tokens int,
      latency_ms int,
      status text,
      created_at timestamptz not null default now()
    );

    create index if not exists idx_messages_team_created on messages(team_id, created_at desc);
    create index if not exists idx_messages_user_created on messages(user_id, created_at desc);
    create index if not exists idx_messages_channel_thread on messages(channel_id, thread_ts);
    create index if not exists idx_sessions_user_last on sessions(user_id, last_activity_at desc);
    ${process.env.USE_RAG === 'true' ? `
    create table if not exists documents (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      original_filename text,
      file_size bigint,
      file_type text,
      language text default 'en',
      embedding_version text default 'v1.0',
      embedding_model text,
      status text default 'active' check (status in ('active', 'inactive', 'processing', 'error')),
      vector_status text default 'indexed' check (vector_status in ('pending', 'processing', 'indexed', 'error')),
      country_code text,
      content_hash text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists chunks (
      id uuid primary key default gen_random_uuid(),
      document_id uuid not null references documents(id) on delete cascade,
      country_code text,
      content text not null,
      embedding vector(${process.env.EMBEDDING_DIM || 1536}),
      created_at timestamptz not null default now()
    );

    create index if not exists idx_chunks_country on chunks(country_code);
    ` : ''}
  `;

  await pool.query(ddl);
}

export async function upsertUserFromSlack(user, teamId) {
  const profile = user.profile || {};
  const firstName = profile.first_name || profile.given_name || null;
  const lastName = profile.last_name || profile.family_name || null;
  const displayName = profile.display_name || null;
  const realName = user.real_name || null;
  const avatarUrl = profile.image_192 || profile.image_72 || null;
  const timezone = user.tz || null;
  const locale = user.locale || null;
  const email = profile.email || null;

  const result = await pool.query(
    `insert into users (
        team_id, slack_user_id, email, first_name, last_name, display_name, real_name, avatar_url, timezone, locale, is_bot, is_app_user, last_seen_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
      on conflict (slack_user_id) do update set
        email = coalesce(excluded.email, users.email),
        first_name = coalesce(excluded.first_name, users.first_name),
        last_name = coalesce(excluded.last_name, users.last_name),
        display_name = coalesce(excluded.display_name, users.display_name),
        real_name = coalesce(excluded.real_name, users.real_name),
        avatar_url = coalesce(excluded.avatar_url, users.avatar_url),
        timezone = coalesce(excluded.timezone, users.timezone),
        locale = coalesce(excluded.locale, users.locale),
        is_bot = excluded.is_bot,
        is_app_user = excluded.is_app_user,
        last_seen_at = now(),
        updated_at = now()
      returning *`,
    [
      teamId,
      user.id,
      email,
      firstName,
      lastName,
      displayName,
      realName,
      avatarUrl,
      timezone,
      locale,
      user.is_bot || false,
      user.is_app_user || false
    ]
  );
  return result.rows[0];
}

export async function createSessionIfNeeded({ teamId, channelId, userId, threadTs }) {
  const existing = await pool.query(
    `select id from sessions
     where team_id=$1 and channel_id=$2 and user_id=$3 and coalesce(thread_ts,'')=coalesce($4,'')
     order by last_activity_at desc limit 1`,
    [teamId, channelId, userId, threadTs || null]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const inserted = await pool.query(
    `insert into sessions (team_id, channel_id, user_id, thread_ts)
     values ($1,$2,$3,$4) returning id`,
    [teamId, channelId, userId, threadTs || null]
  );
  return inserted.rows[0];
}

export async function touchSession(sessionId) {
  await pool.query(
    `update sessions set last_activity_at=now() where id=$1`,
    [sessionId]
  );
}

export async function logMessage({
  teamId, channelId, userId, sessionId,
  role, content, slackTs, threadTs, model,
  promptTokens, completionTokens, latencyMs, status
}) {
  // Local/dev shortcut: print to console instead of writing to DB
  if (process.env.LOG_TO_CONSOLE === 'true') {
    console.log('logMessage (console only):', {
      teamId,
      channelId,
      userId,
      sessionId,
      role,
      content,
      slackTs,
      threadTs,
      model,
      promptTokens,
      completionTokens,
      latencyMs,
      status
    });
    return;
  }
  await pool.query(
    `insert into messages
     (team_id, channel_id, user_id, session_id, role, content, slack_ts, thread_ts, model, prompt_tokens, completion_tokens, latency_ms, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      teamId,
      channelId,
      userId || null,
      sessionId || null,
      role,
      content,
      slackTs || null,
      threadTs || null,
      model || null,
      promptTokens || null,
      completionTokens || null,
      latencyMs || null,
      status || 'ok'
    ]
  );

  // Emit to SSE subscribers if present
  try {
    if (globalThis.__msgBus) {
      const payload = {
        teamId,
        channelId,
        userId,
        sessionId,
        role,
        content,
        model,
        promptTokens,
        completionTokens,
        latencyMs,
        status,
        created_at: new Date().toISOString()
      };
      for (const fn of globalThis.__msgBus) fn(payload);
    }
  } catch {}
}

export function requireAdmin(req, res, next) {
  const adminToken = process.env.ADMIN_TOKEN;
  const provided = req.headers['x-admin-token'];
  if (!adminToken || provided !== adminToken) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}


