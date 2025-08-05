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

## 🤖 Slack Integration

### Setup Slack Bot

1. **Create a Slack App**:
   - Go to [api.slack.com/apps](https://api.slack.com/apps)
   - Click "Create New App" → "From scratch"
   - Name your app (e.g., "Leave Policy Bot")
   - Select your workspace

2. **Configure Bot Token Scopes**:
   - Go to "OAuth & Permissions"
   - Add the following Bot Token Scopes:
     - `app_mentions:read` - View messages that mention the bot
     - `channels:history` - View messages in public channels
     - `channels:read` - View basic information about public channels
     - `chat:write` - Send messages as the bot
     - `im:history` - View messages in direct messages
     - `commands` - Add slash commands

3. **Install App to Workspace**:
   - Go to "Install App" in the sidebar
   - Click "Install to Workspace"
   - Copy the Bot User OAuth Token

4. **Get App Credentials**:
   - Go to "Basic Information"
   - Copy the Signing Secret
   - Go to "App-Level Tokens"
   - Create a new token with `connections:write` scope
   - Copy the App-Level Token

5. **Update Environment Variables**:
   Add these to your `.env` file:
   ```env
   SLACK_BOT_TOKEN=xoxb-your-bot-token
   SLACK_SIGNING_SECRET=your-signing-secret
   SLACK_APP_TOKEN=xapp-your-app-token
   ```

6. **Start the Slack Bot**:
   ```bash
   npm run slack
   ```

### Slack Bot Features

The bot responds to:
- **@mentions** in channels: `@Leave Bot how many vacation days do I get?`
- **Direct messages**: Send any question directly to the bot
- **Slash command**: `/leave-policy How many sick days do I get?`

### Example Slack Interactions

```
User: @Leave Bot what holidays are there in August?
Bot: **Holidays in August 2025:**
     **Mandatory Holidays:**
     • **Independence Day** - 15 - 08 - 2025 (Friday)
     
     **Optional Holidays:**
     • **Varamahalakshmi Vrata** - 08 - 08 - 2025 (Friday)
     • **Raksha Bandhan** - 09 - 08 - 2025 (Saturday)
     • **Janmashtami** - 16 - 08 - 2025 (Saturday)
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
│   ├── slackBot.js         # Slack bot integration
│   ├── documentParser.js   # PDF parsing logic
│   ├── openaiClient.js     # OpenAI API integration
│   └── policyQA.js         # Question answering logic
├── slack-server.js         # Slack bot server
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
- ✅ Slack bot integration with @mentions, DMs, and slash commands
- ✅ Web interface for testing

## 🔮 Next Steps

1. **Document Upload**: Web interface for uploading new policies
2. **Document Types**: Support for DOCX, TXT files
3. **Database**: Store processed documents in a database
4. **Authentication**: Add user authentication for admin features
5. **Analytics**: Track most asked questions and bot usage

## 🛠️ Development

To modify the bot's behavior:
- Edit the system prompt in `src/openaiClient.js`
- Adjust the policy keyword filter in `src/policyQA.js`
- Add support for more document types in `src/documentParser.js`
- Customize Slack responses in `src/slackBot.js`

## 📝 License

MIT License 