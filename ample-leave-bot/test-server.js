import { parseAllPolicyDocs } from './src/documentParser.js';

console.log('🧪 Testing document parser...');

const policyText = await parseAllPolicyDocs();
console.log('\n📄 Policy text loaded:');
console.log('Length:', policyText.length);
console.log('First 500 characters:');
console.log(policyText.substring(0, 500));
console.log('\n✅ Document parsing test complete!'); 