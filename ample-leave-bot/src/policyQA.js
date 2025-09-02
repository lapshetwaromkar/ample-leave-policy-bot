import { askOpenAI } from './openaiClient.js';

export async function answerPolicyQuestion(question, policyText) {
  // Check if policy text is available
  if (!policyText || policyText.trim().length === 0) {
    return { text: "I don't have access to any policy documents at the moment. Please make sure policy documents are uploaded to the /docs folder.", usage: null };
  }

  // Check if this is a context-aware question (mentions previous messages)
  const contextKeywords = [
    'above', 'previous', 'last message', 'remove', 'recalculate', 'update', 'modify',
    'from the above', 'from above', 'in the above', 'in above', 'above message',
    'that list', 'that response', 'that answer', 'the list above', 'the response above'
  ];
  
  const questionLower = question.toLowerCase();
  const isContextQuestion = contextKeywords.some(keyword => 
    questionLower.includes(keyword)
  );

  // Improved question filtering - more flexible for follow-up questions
  const policyKeywords = [
    'leave', 'vacation', 'sick', 'holiday', 'time off', 'pto', 'maternity', 'paternity', 
    'bereavement', 'annual', 'policy', 'days', 'hours', 'total', 'number', 'how many',
    'casual', 'earned', 'marriage', 'paw', 'tenure', 'calendar', 'year', 'get', 'entitled',
    'remove', 'recalculate', 'update', 'modify', 'above', 'previous', 'context',
    'holidays', 'holiday', 'august', 'month', 'this month', 'what are', 'which holidays'
  ];
  
  const containsPolicyKeyword = policyKeywords.some(keyword => 
    questionLower.includes(keyword)
  );

  // Additional check for common follow-up phrases
  const followUpPhrases = [
    'total number', 'just give me', 'how much', 'what is the', 'tell me the',
    'give me the', 'what are the', 'how many total', 'remove', 'recalculate',
    'from above', 'above message', 'that list', 'that response', 'holidays in',
    'what holidays', 'which holidays', 'holidays this month'
  ];
  
  const isFollowUp = followUpPhrases.some(phrase => 
    questionLower.includes(phrase)
  );

  // If it's clearly not policy related and not a follow-up, reject
  if (!containsPolicyKeyword && !isFollowUp && !isContextQuestion) {
    const nonPolicyKeywords = ['weather', 'password', 'lunch', 'time now', 'date today'];
    const isNonPolicy = nonPolicyKeywords.some(keyword => questionLower.includes(keyword));
    
    if (isNonPolicy) {
      return { text: "I can only help with questions related to leave policies, vacation time, sick leave, and other time-off policies. Please ask a question about these topics.", usage: null };
    }
  }

  try {
    const { text, usage } = await askOpenAI(question, policyText);
    return { text, usage };
  } catch (error) {
    console.error('Error answering question:', error);
    return { text: "I'm sorry, I encountered an error while processing your question. Please try again later.", usage: null };
  }
} 