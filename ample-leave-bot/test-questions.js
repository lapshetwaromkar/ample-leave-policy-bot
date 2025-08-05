#!/usr/bin/env node

const testQuestions = [
  "How many vacation days do I get per year?",
  "What is the sick leave policy?", 
  "How long is maternity leave?",
  "What holidays does the company observe?",
  "How do I request time off?",
  "Can I carry over vacation days to next year?",
  "What is bereavement leave?",
  "What's the weather today?", // This should be filtered out
  "How many hours in a work day?", // This should be filtered out
];

async function testQuestion(question) {
  try {
    const response = await fetch('http://localhost:3000/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question })
    });

    const data = await response.json();
    
    console.log(`\n🤔 Question: ${question}`);
    console.log(`🤖 Answer: ${data.answer}`);
    console.log(`─`.repeat(80));
    
    return { question, answer: data.answer, success: response.ok };
  } catch (error) {
    console.log(`\n❌ Error testing question: ${question}`);
    console.log(`Error: ${error.message}`);
    console.log(`─`.repeat(80));
    return { question, error: error.message, success: false };
  }
}

async function runAllTests() {
  console.log(`🧪 Starting automated tests for Leave Policy Bot`);
  console.log(`📝 Testing ${testQuestions.length} questions...\n`);

  // Check if server is running
  try {
    const healthCheck = await fetch('http://localhost:3000/');
    const health = await healthCheck.json();
    console.log(`✅ Server Status: ${health.status}`);
    console.log(`📄 Policy Text Length: ${health.policyTextLength} characters`);
    console.log(`🔄 Ready: ${health.ready}\n`);
  } catch (error) {
    console.log(`❌ Server not running! Please start the server first with: npm start`);
    process.exit(1);
  }

  const results = [];
  for (const question of testQuestions) {
    const result = await testQuestion(question);
    results.push(result);
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Summary
  console.log(`\n📊 TEST SUMMARY`);
  console.log(`═`.repeat(80));
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`✅ Successful: ${successful}/${testQuestions.length}`);
  console.log(`❌ Failed: ${failed}/${testQuestions.length}`);
  
  if (failed > 0) {
    console.log(`\n❌ Failed Questions:`);
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.question}`);
    });
  }
  
  console.log(`\n🎉 Testing complete!`);
}

// Run tests
runAllTests().catch(console.error); 