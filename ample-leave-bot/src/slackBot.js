import pkg from '@slack/bolt';
const { App } = pkg;
import { parseAllPolicyDocs } from './documentParser.js';
import { answerPolicyQuestion } from './policyQA.js';
import { upsertUserFromSlack, createSessionIfNeeded, logMessage, touchSession } from './db.js';
import { searchSimilar } from './rag.js';

// Request queue for handling high concurrency
class RequestQueue {
  constructor(maxConcurrent = 50) {
    this.queue = [];
    this.running = 0;
    this.maxConcurrent = maxConcurrent;
  }

  async add(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.running >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    this.running++;
    const { fn, resolve, reject } = this.queue.shift();

    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.running--;
      this.process();
    }
  }
}

const requestQueue = new RequestQueue(50); // Max 50 concurrent OpenAI requests

// Rate limiting per user
const userRateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 10;

function checkRateLimit(userId) {
  const now = Date.now();
  const userRequests = userRateLimit.get(userId) || [];
  
  // Remove old requests outside the window
  const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
    return false; // Rate limited
  }
  
  recentRequests.push(now);
  userRateLimit.set(userId, recentRequests);
  return true; // Allowed
}

// Initialize Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

// Load policy documents
let policyText = '';
let isReady = false;
const USE_RAG = process.env.USE_RAG === 'true';

// Conversation context storage with size limit for memory management
const conversationContext = new Map();
const MAX_CONTEXT_SIZE = 1000; // Limit to 1000 active conversations

// Cleanup old conversations periodically
setInterval(() => {
  if (conversationContext.size > MAX_CONTEXT_SIZE) {
    const entries = Array.from(conversationContext.entries());
    const sortedByTime = entries.sort((a, b) => (a[1].lastActivity || 0) - (b[1].lastActivity || 0));
    const toDelete = sortedByTime.slice(0, conversationContext.size - MAX_CONTEXT_SIZE);
    toDelete.forEach(([key]) => conversationContext.delete(key));
    console.log(`🧹 Cleaned up ${toDelete.length} old conversations`);
  }
}, 5 * 60 * 1000); // Every 5 minutes

(async () => {
  console.log('Loading policy documents for Slack bot...');
  try {
    policyText = await parseAllPolicyDocs();
    console.log(`Loaded ${policyText.length} characters from policy documents`);
    isReady = true;
  } catch (error) {
    console.error('Error loading policy documents:', error);
  }
})();

// ONE PLACE: Debug log of who is sending the request
app.use(async ({ client, event, body, next }) => {
  try {
    const userId = event?.user || body?.user_id;
    const channelId = event?.channel || body?.channel_id;
    const threadTs = event?.thread_ts || event?.ts || null;
    if (userId) {
      const info = await client.users.info({ user: userId });
      const p = info.user?.profile || {};
      console.log('Incoming Slack request:', {
        userId,
        channelId,
        thread_ts: threadTs,
        email: p.email || null,
        display_name: p.display_name || null,
        real_name: info.user?.real_name || null,
        timezone: info.user?.tz || null,
        locale: info.user?.locale || null
      });
    } else {
      console.log('Incoming Slack request (no userId)', { channelId, threadTs });
    }
  } catch (e) {
    console.warn('Debug user log failed:', e.message);
  }
  await next();
});

// Helper: try to fetch as much user info as possible for diagnostics
async function diagnoseUserInfo(userId, channelId, client) {
  const result = { ok: true, userId, channelId };
  try {
    const { user } = await client.users.info({ user: userId });
    const p = user?.profile || {};
    result.users_info = {
      id: user?.id,
      real_name: user?.real_name || null,
      display_name: p.display_name || null,
      email: p.email || null,
      tz: user?.tz || null,
      locale: user?.locale || null,
      has_custom_fields: !!p.fields && Object.keys(p.fields).length > 0,
      images: {
        image_72: p.image_72 || null,
        image_192: p.image_192 || null
      }
    };
  } catch (e) {
    result.users_info_error = e?.data || e.message;
  }
  try {
    const { team } = await client.team.info();
    result.team_info = { id: team?.id, name: team?.name, domain: team?.domain };
  } catch (e) {
    result.team_info_error = e?.data || e.message;
  }
  try {
    const presence = await client.users.getPresence({ user: userId });
    result.presence = presence?.presence || null;
  } catch (e) {
    result.presence_error = e?.data || e.message;
  }
  console.log('User diagnostics:', result);
  return result;
}

// Helper function to get conversation context
function getConversationContext(channelId, userId) {
  const key = `${channelId}-${userId}`;
  if (!conversationContext.has(key)) {
    conversationContext.set(key, {
      messages: [],
      lastResponse: null
    });
  }
  return conversationContext.get(key);
}

// Helper function to update conversation context
function updateConversationContext(channelId, userId, userMessage, botResponse) {
  const context = getConversationContext(channelId, userId);
  context.messages.push({
    role: 'user',
    content: userMessage
  });
  context.messages.push({
    role: 'assistant',
    content: botResponse
  });
  context.lastResponse = botResponse;
  
  // Keep only last 10 messages to prevent context from getting too long
  if (context.messages.length > 10) {
    context.messages = context.messages.slice(-10);
  }
}

// Handle app mentions
app.event('app_mention', async ({ event, say, client, context: boltContext }) => {
  try {
    const question = event.text.replace(/<@[^>]+>/, '').trim();
    const convo = getConversationContext(event.channel, event.user);
    
    if (!question) {
      await say({
        text: "Hi! I'm your leave policy assistant. Ask me anything about vacation days, sick leave, maternity/paternity leave, holidays, or other time-off policies.",
        thread_ts: event.ts
      });
      return;
    }

    if (!isReady) {
      await say({
        text: "I'm still loading the policy documents. Please try again in a moment.",
        thread_ts: event.ts
      });
      return;
    }

    // Rate limiting check
    if (!checkRateLimit(event.user)) {
      await say({
        text: "⏰ You're sending questions too quickly. Please wait a minute before asking again. (Limit: 10 questions per minute)",
        thread_ts: event.ts
      });
      return;
    }

    console.log(`Slack question received: ${question}`);
    console.log(`Context messages count: ${convo.messages.length}`);
    
    // Create context-aware prompt
    let contextPrompt = question;
    if (convo.messages.length > 0) {
      const recentMessages = convo.messages.slice(-4); // Last 2 exchanges
      contextPrompt = `Previous conversation context:\n${recentMessages.map(msg => `${msg.role}: ${msg.content}`).join('\n')}\n\nCurrent question: ${question}`;
      console.log(`Context-aware prompt created with ${recentMessages.length} previous messages`);
    } else {
      console.log(`No previous context found, using direct question`);
    }
    
    const teamId = boltContext?.teamId || event?.team || process.env.SLACK_TEAM_ID || 'slack';
    // Run diagnostics once per event to see what fields we can access
    await diagnoseUserInfo(event.user, event.channel, client);

    // Ensure user exists in DB
    let userRow = null;
    try {
      const userInfo = await client.users.info({ user: event.user });
      userRow = await upsertUserFromSlack(userInfo.user, teamId);
    } catch (e) {
      console.warn('Could not upsert Slack user:', e.message);
    }

    // Create or reuse a session
    let session = null;
    try {
      if (userRow) {
        session = await createSessionIfNeeded({
          teamId,
          channelId: event.channel,
          userId: userRow.id,
          threadTs: event.thread_ts || event.ts
        });
      }
    } catch (e) {
      console.warn('Could not create/find session:', e.message);
    }

    // Log user message
    try {
      await logMessage({
        teamId,
        channelId: event.channel,
        userId: userRow?.id,
        sessionId: session?.id,
        role: 'user',
        content: question,
        slackTs: event.ts,
        threadTs: event.thread_ts || event.ts,
        status: 'ok'
      });
    } catch (e) {
      console.warn('Could not log user message:', e.message);
    }

    // Queue the expensive OpenAI operation
    const result = await requestQueue.add(async () => {
      const t0 = Date.now();
      let ragContext = policyText;
      
      if (USE_RAG) {
        const slackTz = userRow?.timezone || null;
        const inferredCountry = process.env.DEFAULT_COUNTRY || null; // TODO: map tz/locale to country
        const hits = await searchSimilar({ query: question, countryCode: inferredCountry });
        const joined = hits.map(h => h.content).join('\n\n');
        ragContext = joined || policyText;
      }

      const { text: answerText, usage } = await answerPolicyQuestion(contextPrompt, ragContext);
      return { answerText, usage, latency: Date.now() - t0 };
    });

    const { answerText, usage, latency } = result;

    await say({
      text: answerText,
      thread_ts: event.ts
    });
    
    // Update conversation context
    updateConversationContext(event.channel, event.user, question, answerText);
    console.log(`Updated conversation context for user ${event.user}`);

    // Log assistant message
    try {
      await logMessage({
        teamId,
        channelId: event.channel,
        userId: userRow?.id,
        sessionId: session?.id,
        role: 'assistant',
        content: answerText,
        slackTs: undefined,
        threadTs: event.thread_ts || event.ts,
        model: 'gpt-4o-mini',
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        latencyMs: latency,
        status: 'ok'
      });
      if (session?.id) await touchSession(session.id);
    } catch (e) {
      console.warn('Could not log assistant message:', e.message);
    }
    
  } catch (error) {
    console.error('Error processing Slack question:', error);
    await say({
      text: "I'm sorry, I encountered an error while processing your question. Please try again later.",
      thread_ts: event.ts
    });
  }
});

// Handle direct messages
app.event('message', async ({ event, say, client, context: boltContext }) => {
  // Only respond to direct messages (not in channels)
  if (event.channel_type === 'im' && !event.bot_id) {
    try {
      const question = event.text.trim();
      const convo = getConversationContext(event.channel, event.user);
      
      if (!question) {
        await say("Hi! I'm your leave policy assistant. Ask me anything about vacation days, sick leave, maternity/paternity leave, holidays, or other time-off policies.");
        return;
      }

      if (!isReady) {
        await say("I'm still loading the policy documents. Please try again in a moment.");
        return;
      }

      console.log(`Slack DM question received: ${question}`);
      
      // Create context-aware prompt
      let contextPrompt = question;
      if (convo.messages.length > 0) {
        const recentMessages = convo.messages.slice(-4); // Last 2 exchanges
        contextPrompt = `Previous conversation context:\n${recentMessages.map(msg => `${msg.role}: ${msg.content}`).join('\n')}\n\nCurrent question: ${question}`;
      }
      
      const teamId = boltContext?.teamId || event?.team || process.env.SLACK_TEAM_ID || 'slack';
      await diagnoseUserInfo(event.user, event.channel, client);

      // Ensure user exists in DB
      let userRow = null;
      try {
        const userInfo = await client.users.info({ user: event.user });
        userRow = await upsertUserFromSlack(userInfo.user, teamId);
      } catch (e) {
        console.warn('Could not upsert Slack user:', e.message);
      }

      // Create or reuse a session
      let session = null;
      try {
        if (userRow) {
          session = await createSessionIfNeeded({
            teamId,
            channelId: event.channel,
            userId: userRow.id,
            threadTs: event.thread_ts || event.ts
          });
        }
      } catch (e) {
        console.warn('Could not create/find session:', e.message);
      }

      // Log user message
      try {
        await logMessage({
          teamId,
          channelId: event.channel,
          userId: userRow?.id,
          sessionId: session?.id,
          role: 'user',
          content: question,
          slackTs: event.ts,
          threadTs: event.thread_ts || event.ts,
          status: 'ok'
        });
      } catch (e) {
        console.warn('Could not log user message:', e.message);
      }

      const t0 = Date.now();
      let ragContext = policyText;
      if (USE_RAG) {
        const slackTz = userRow?.timezone || null;
        const inferredCountry = process.env.DEFAULT_COUNTRY || null; // TODO: map tz/locale to country
        const hits = await searchSimilar({ query: question, countryCode: inferredCountry });
        const joined = hits.map(h => h.content).join('\n\n');
        ragContext = joined || policyText;
      }
      const { text: answerText, usage } = await answerPolicyQuestion(contextPrompt, ragContext);
      
      await say(answerText);
      
      // Update conversation context
      updateConversationContext(event.channel, event.user, question, answerText);

      // Log assistant message
      try {
        await logMessage({
          teamId,
          channelId: event.channel,
          userId: userRow?.id,
          sessionId: session?.id,
          role: 'assistant',
          content: answerText,
          threadTs: event.thread_ts || event.ts,
          model: 'gpt-4o-mini',
          promptTokens: usage?.prompt_tokens,
          completionTokens: usage?.completion_tokens,
          latencyMs: Date.now() - t0,
          status: 'ok'
        });
        if (session?.id) await touchSession(session.id);
      } catch (e) {
        console.warn('Could not log assistant message:', e.message);
      }
      
    } catch (error) {
      console.error('Error processing Slack DM:', error);
      await say("I'm sorry, I encountered an error while processing your question. Please try again later.");
    }
  }
});

// Health check command
app.command('/leave-policy', async ({ command, ack, respond, client, context: boltContext }) => {
  await ack();
  
  const question = command.text.trim();
  const context = getConversationContext(command.channel_id, command.user_id);
  
  if (!question) {
    await respond({
      text: "Hi! I'm your leave policy assistant. Ask me anything about vacation days, sick leave, maternity/paternity leave, holidays, or other time-off policies.",
      response_type: 'ephemeral'
    });
    return;
  }

  if (!isReady) {
    await respond({
      text: "I'm still loading the policy documents. Please try again in a moment.",
      response_type: 'ephemeral'
    });
    return;
  }

  try {
    console.log(`Slack command question received: ${question}`);
    
    // Create context-aware prompt
    let contextPrompt = question;
    if (context.messages.length > 0) {
      const recentMessages = context.messages.slice(-4); // Last 2 exchanges
      contextPrompt = `Previous conversation context:\n${recentMessages.map(msg => `${msg.role}: ${msg.content}`).join('\n')}\n\nCurrent question: ${question}`;
    }
    
    const teamId = boltContext?.teamId || command?.team_id || process.env.SLACK_TEAM_ID || 'slack';
    await diagnoseUserInfo(command.user_id, command.channel_id, client);

    // Ensure user exists in DB
    let userRow = null;
    try {
      const userInfo = await client.users.info({ user: command.user_id });
      userRow = await upsertUserFromSlack(userInfo.user, teamId);
    } catch (e) {
      console.warn('Could not upsert Slack user:', e.message);
    }

    // Create or reuse a session
    let session = null;
    try {
      if (userRow) {
        session = await createSessionIfNeeded({
          teamId,
          channelId: command.channel_id,
          userId: userRow.id,
          threadTs: null
        });
      }
    } catch (e) {
      console.warn('Could not create/find session:', e.message);
    }

    // Log user message
    try {
      await logMessage({
        teamId,
        channelId: command.channel_id,
        userId: userRow?.id,
        sessionId: session?.id,
        role: 'user',
        content: question,
        slackTs: command.trigger_id,
        threadTs: null,
        status: 'ok'
      });
    } catch (e) {
      console.warn('Could not log user message:', e.message);
    }

    const t0 = Date.now();
    let ragContext = policyText;
    if (USE_RAG) {
      const inferredCountry = process.env.DEFAULT_COUNTRY || null;
      const hits = await searchSimilar({ query: question, countryCode: inferredCountry });
      const joined = hits.map(h => h.content).join('\n\n');
      ragContext = joined || policyText;
    }
    const { text: answerText, usage } = await answerPolicyQuestion(contextPrompt, ragContext);
    
    await respond({
      text: answerText,
      response_type: 'in_channel'
    });
    
    // Update conversation context
    updateConversationContext(command.channel_id, command.user_id, question, answerText);

    // Log assistant message
    try {
      await logMessage({
        teamId,
        channelId: command.channel_id,
        userId: userRow?.id,
        sessionId: session?.id,
        role: 'assistant',
        content: answerText,
        model: 'gpt-4o-mini',
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        latencyMs: Date.now() - t0,
        status: 'ok'
      });
      if (session?.id) await touchSession(session.id);
    } catch (e) {
      console.warn('Could not log assistant message:', e.message);
    }
    
  } catch (error) {
    console.error('Error processing Slack command:', error);
    await respond({
      text: "I'm sorry, I encountered an error while processing your question. Please try again later.",
      response_type: 'ephemeral'
    });
  }
});

// Start the app
(async () => {
  await app.start();
  console.log('⚡️ Slack bot is running!');
})();

export default app; 