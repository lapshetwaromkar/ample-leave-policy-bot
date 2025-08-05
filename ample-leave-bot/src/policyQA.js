import { askOpenAI } from './openaiClient.js';

export async function answerPolicyQuestion(question, policyText) {
  // Check if policy text is available
  if (!policyText || policyText.trim().length === 0) {
    return "I don't have access to any policy documents at the moment. Please make sure policy documents are uploaded to the /docs folder.";
  }

  // Improved question filtering - more flexible for follow-up questions
  const policyKeywords = [
    'leave', 'vacation', 'sick', 'holiday', 'time off', 'pto', 'maternity', 'paternity', 
    'bereavement', 'annual', 'policy', 'days', 'hours', 'total', 'number', 'how many',
    'casual', 'earned', 'marriage', 'paw', 'tenure', 'calendar', 'year', 'get', 'entitled'
  ];
  
  const questionLower = question.toLowerCase();
  const containsPolicyKeyword = policyKeywords.some(keyword => 
    questionLower.includes(keyword)
  );

  // Additional check for common follow-up phrases
  const followUpPhrases = [
    'total number', 'just give me', 'how much', 'what is the', 'tell me the',
    'give me the', 'what are the', 'how many total'
  ];
  
  const isFollowUp = followUpPhrases.some(phrase => 
    questionLower.includes(phrase)
  );

  // If it's clearly not policy related and not a follow-up, reject
  if (!containsPolicyKeyword && !isFollowUp) {
    const nonPolicyKeywords = ['weather', 'password', 'lunch', 'time now', 'date today'];
    const isNonPolicy = nonPolicyKeywords.some(keyword => questionLower.includes(keyword));
    
    if (isNonPolicy) {
      return "I can only help with questions related to leave policies, vacation time, sick leave, and other time-off policies. Please ask a question about these topics.";
    }
  }

  try {
    const answer = await askOpenAI(question, policyText);
    return answer;
  } catch (error) {
    console.error('Error answering question:', error);
    return "I'm sorry, I encountered an error while processing your question. Please try again later.";
  }
} 