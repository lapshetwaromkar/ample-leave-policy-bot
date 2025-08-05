import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsDir = path.join(__dirname, '..', 'docs');

async function parsePDFWithPdfjs(filePath) {
  try {
    console.log(`🔍 Attempting to parse PDF: ${path.basename(filePath)}`);
    
    const data = new Uint8Array(await fs.readFile(filePath));
    console.log(`📄 PDF file loaded: ${data.length} bytes`);
    
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    console.log(`📖 PDF has ${pdf.numPages} pages`);
    
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      console.log(`📄 Processing page ${i}/${pdf.numPages}`);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      text += pageText + '\n\n';
    }
    
    console.log(`✅ PDF parsed successfully: ${text.length} characters extracted`);
    return text;
  } catch (error) {
    console.error(`❌ PDF.js failed to parse ${path.basename(filePath)}:`, error.message);
    return `[PDF parsing failed for ${path.basename(filePath)}. Error: ${error.message}. Please convert this PDF to text format manually.]`;
  }
}

export async function parseAllPolicyDocs() {
  let combinedText = '';
  let files;
  
  console.log(`📂 Looking for documents in: ${docsDir}`);
  
  try {
    files = await fs.readdir(docsDir);
    console.log(`📋 Found files: ${files.join(', ')}`);
  } catch (e) {
    console.log('❌ No docs directory found or empty');
    return '';
  }
  
  if (files.length === 0) {
    console.log('⚠️  No files found in docs directory');
    return '';
  }
  
  for (const file of files) {
    const filePath = path.join(docsDir, file);
    console.log(`\n🔄 Processing: ${file}`);
    
    if (file.toLowerCase().endsWith('.pdf')) {
      const pdfText = await parsePDFWithPdfjs(filePath);
      combinedText += `\n--- ${file} ---\n` + pdfText;
      console.log(`📊 Added PDF content: ${pdfText.length} characters`);
      
    } else if (file.endsWith('.md') || file.endsWith('.txt')) {
      try {
        const data = await fs.readFile(filePath, 'utf8');
        combinedText += `\n--- ${file} ---\n` + data;
        console.log(`✅ Added text file: ${file} (${data.length} characters)`);
      } catch (error) {
        console.error(`❌ Error reading ${file}:`, error.message);
      }
      
    } else {
      console.log(`⏭️  Skipping unsupported file: ${file}`);
    }
  }
  
  console.log(`\n📊 SUMMARY:`);
  console.log(`📝 Total combined text length: ${combinedText.length} characters`);
  
  if (combinedText.length < 100) {
    console.log(`⚠️  Very little content loaded. Please check your documents.`);
  } else {
    console.log(`✅ Policy documents loaded successfully!`);
  }
  
  return combinedText;
} 