import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseAllPolicyDocs } from './documentParser.js';
import { answerPolicyQuestion } from './policyQA.js';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(express.json());

// CORS middleware for testing
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Load and parse all policy documents on startup
let policyText = '';
let isReady = false;

(async () => {
  console.log('Loading policy documents...');
  try {
    policyText = await parseAllPolicyDocs();
    console.log(`Loaded ${policyText.length} characters from policy documents`);
    isReady = true;
  } catch (error) {
    console.error('Error loading policy documents:', error);
  }
})();

// Serve test interface
app.get('/test', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'test-interface.html'));
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'running',
    ready: isReady,
    policyTextLength: policyText.length,
    testInterface: 'http://localhost:3000/test'
  });
});

// Ask question endpoint
app.post('/ask', async (req, res) => {
  if (!isReady) {
    return res.status(503).json({ error: 'Server is still loading policy documents. Please try again in a moment.' });
  }

  const { question } = req.body;
  if (!question) {
    return res.status(400).json({ error: 'Missing question in request body' });
  }

  console.log(`Question received: ${question}`);
  
  try {
    const answer = await answerPolicyQuestion(question, policyText);
    console.log(`Answer generated: ${answer.substring(0, 100)}...`);
    res.json({ question, answer });
  } catch (err) {
    console.error('Error processing question:', err);
    res.status(500).json({ error: 'Internal server error while processing your question' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Ample Leave Policy Bot server running on port ${PORT}`);
  console.log(`📄 Place your policy PDF files in the /docs folder`);
  console.log(`🔑 Make sure to set your OPENAI_API_KEY in the .env file`);
  console.log(`💬 Test with: POST http://localhost:${PORT}/ask`);
  console.log(`🌐 Test Interface: http://localhost:${PORT}/test`);
}); 