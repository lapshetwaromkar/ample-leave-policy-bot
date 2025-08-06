import pkg from '@slack/bolt';
const { App } = pkg;
import { parseAllPolicyDocs } from './documentParser.js';
import { answerPolicyQuestion } from './policyQA.js';

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

// Conversation context storage
const conversationContext = new Map();

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
app.event('app_mention', async ({ event, say }) => {
  try {
    const question = event.text.replace(/<@[^>]+>/, '').trim();
    const context = getConversationContext(event.channel, event.user);
    
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

    console.log(`Slack question received: ${question}`);
    console.log(`Context messages count: ${context.messages.length}`);
    
    // Create context-aware prompt
    let contextPrompt = question;
    if (context.messages.length > 0) {
      const recentMessages = context.messages.slice(-4); // Last 2 exchanges
      contextPrompt = `Previous conversation context:\n${recentMessages.map(msg => `${msg.role}: ${msg.content}`).join('\n')}\n\nCurrent question: ${question}`;
      console.log(`Context-aware prompt created with ${recentMessages.length} previous messages`);
    } else {
      console.log(`No previous context found, using direct question`);
    }
    
    const answer = await answerPolicyQuestion(contextPrompt, policyText);
    
    await say({
      text: answer,
      thread_ts: event.ts
    });
    
    // Update conversation context
    updateConversationContext(event.channel, event.user, question, answer);
    console.log(`Updated conversation context for user ${event.user}`);
    
  } catch (error) {
    console.error('Error processing Slack question:', error);
    await say({
      text: "I'm sorry, I encountered an error while processing your question. Please try again later.",
      thread_ts: event.ts
    });
  }
});

// Handle direct messages
app.event('message', async ({ event, say }) => {
  // Only respond to direct messages (not in channels)
  if (event.channel_type === 'im' && !event.bot_id) {
    try {
      const question = event.text.trim();
      const context = getConversationContext(event.channel, event.user);
      
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
      if (context.messages.length > 0) {
        const recentMessages = context.messages.slice(-4); // Last 2 exchanges
        contextPrompt = `Previous conversation context:\n${recentMessages.map(msg => `${msg.role}: ${msg.content}`).join('\n')}\n\nCurrent question: ${question}`;
      }
      
      const answer = await answerPolicyQuestion(contextPrompt, policyText);
      
      await say(answer);
      
      // Update conversation context
      updateConversationContext(event.channel, event.user, question, answer);
      
    } catch (error) {
      console.error('Error processing Slack DM:', error);
      await say("I'm sorry, I encountered an error while processing your question. Please try again later.");
    }
  }
});

// Health check command
app.command('/leave-policy', async ({ command, ack, respond }) => {
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
    
    const answer = await answerPolicyQuestion(contextPrompt, policyText);
    
    await respond({
      text: answer,
      response_type: 'in_channel'
    });
    
    // Update conversation context
    updateConversationContext(command.channel_id, command.user_id, question, answer);
    
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