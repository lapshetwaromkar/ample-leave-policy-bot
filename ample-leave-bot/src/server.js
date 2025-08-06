import express from 'express';
import { parseAllPolicyDocs } from './documentParser.js';
import { answerPolicyQuestion } from './policyQA.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

let policyContext = '';

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    policyLoaded: policyContext.length > 0
  });
});

app.post('/ask', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    console.log(`Question received: ${question}`);
    
    const answer = await answerPolicyQuestion(question, policyContext);
    console.log(`Answer generated: ${answer.substring(0, 100)}...`);
    
    res.json({ answer });
  } catch (error) {
    console.error('Error processing question:', error);
    res.status(500).json({ error: 'Failed to process question' });
  }
});

// Load policy documents on startup
console.log('Loading policy documents...');
parseAllPolicyDocs().then(context => {
  policyContext = context;
  console.log(`Loaded ${context.length} characters from policy documents`);
  
  app.listen(PORT, () => {
    console.log(`🚀 Ample Leave Policy Bot server running on port ${PORT}`);
    console.log('📄 Place your policy PDF files in the /docs folder');
    console.log('🔑 Make sure to set your OPENAI_API_KEY in the .env file');
    console.log('💬 Test with: POST http://localhost:3000/ask');
    console.log('🌐 Test Interface: http://localhost:3000/test');
  });
}).catch(error => {
  console.error('Failed to load policy documents:', error);
  process.exit(1);
}); 