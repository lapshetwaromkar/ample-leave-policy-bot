# Ample Leave Policy Bot

A Node.js server that answers employee questions about company leave policies using OpenAI GPT. This bot reads policy documents (PDFs) and provides intelligent answers based on the content.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Set Up Environment Variables
Create a `.env` file in the root directory:
```env
OPENAI_API_KEY=your-openai-api-key-here
```

### 3. Add Policy Documents
- Create a `docs/` folder in the root directory
- Place your policy PDF files in the `docs/` folder
- The bot will automatically load and parse all PDF files on startup

### 4. Start the Server
```bash
npm start
```

The server will run on `http://localhost:3000`

## 📋 API Endpoints

### GET `/`
Health check endpoint
```bash
curl http://localhost:3000/
```

Response:
```json
{
  "status": "running",
  "ready": true,
  "policyTextLength": 15420
}
```

### POST `/ask`
Ask a question about leave policies
```bash
curl -X POST http://localhost:3000/ask \
  -H "Content-Type: application/json" \
  -d '{"question": "How many vacation days do I get per year?"}'
```

Response:
```json
{
  "question": "How many vacation days do I get per year?",
  "answer": "Based on the company policy, full-time employees receive 15 vacation days per year..."
}
```

## 🧪 Testing Examples

### Valid Policy Questions:
- "How many sick days do I get?"
- "What is the maternity leave policy?"
- "Can I carry over vacation days to next year?"
- "What holidays does the company observe?"
- "How do I request time off?"

### Invalid Questions (will be rejected):
- "What's the weather today?"
- "How do I reset my password?"
- "What's for lunch?"

## 📁 Project Structure

```
ample-leave-bot/
├── docs/                    # Place your policy PDF files here
├── src/
│   ├── server.js           # Main Express server
│   ├── documentParser.js   # PDF parsing logic
│   ├── openaiClient.js     # OpenAI API integration
│   └── policyQA.js         # Question answering logic
├── package.json
├── .env                    # Environment variables
└── README.md
```

## 🔧 Features

- ✅ Automatically loads and parses PDF policy documents
- ✅ Filters questions to only answer policy-related queries
- ✅ Uses OpenAI GPT-4 for intelligent responses
- ✅ Error handling and logging
- ✅ Health check endpoint
- ✅ Ready for Slack integration

## 🔮 Next Steps

1. **Slack Integration**: Add Slack bot functionality
2. **Document Upload**: Web interface for uploading new policies
3. **Document Types**: Support for DOCX, TXT files
4. **Database**: Store processed documents in a database
5. **Authentication**: Add user authentication for admin features

## 🛠️ Development

To modify the bot's behavior:
- Edit the system prompt in `src/openaiClient.js`
- Adjust the policy keyword filter in `src/policyQA.js`
- Add support for more document types in `src/documentParser.js`

## 📝 License

MIT License 