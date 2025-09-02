import { pool } from './db.js';
import { embedTexts } from './openaiClient.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const DEFAULT_CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || '2000', 10); // Increased from 1000 to 2000
const DEFAULT_CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || '300', 10); // Increased from 200 to 300
const DEFAULT_TOP_K = parseInt(process.env.TOP_K || '10', 10); // Increased from 6 to 10

export function chunkText(text, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
  // Smart chunking: try to keep holiday lists together
  const chunks = [];
  
  // First, try to find holiday sections and keep them intact
  const holidayPatterns = [
    /LIST OF MANDATORY HOLIDAYS.*?Optional Holidays List/gs,
    /Mandatory Public Holidays.*?Optional Holidays List/gs,
    /Optional Holidays List.*?## Summary/gs,  // More specific pattern to capture full optional list
    /Optional Holidays List.*?## Leave Policy Details/gs  // Alternative pattern
  ];
  
  let currentPos = 0;
  let foundHolidaySection = false;
  
  for (const pattern of holidayPatterns) {
    const match = pattern.exec(text.slice(currentPos));
    if (match) {
      foundHolidaySection = true;
      // Add content before holiday section
      if (match.index > 0) {
        const beforeHolidays = text.slice(currentPos, currentPos + match.index);
        chunks.push(...chunkTextBySize(beforeHolidays, chunkSize, overlap));
      }
      
      // Keep holiday section as one chunk (it's important content)
      const holidaySection = text.slice(currentPos + match.index, currentPos + match.index + match[0].length);
      console.log(`🔍 Keeping holiday section as single chunk: ${holidaySection.length} characters`);
      chunks.push(holidaySection);
      
      currentPos += match.index + match[0].length;
      break; // Found the holiday section, stop looking
    }
  }
  
  // If no holiday patterns found, use regular chunking
  if (!foundHolidaySection) {
    console.log(`⚠️ No holiday patterns found, using regular chunking`);
    return chunkTextBySize(text, chunkSize, overlap);
  } else {
    // Add remaining content after holiday sections
    if (currentPos < text.length) {
      const remainingText = text.slice(currentPos);
      chunks.push(...chunkTextBySize(remainingText, chunkSize, overlap));
    }
  }
  
  console.log(`🔍 Total chunks created: ${chunks.length}`);
  chunks.forEach((chunk, index) => {
    console.log(`🔍 Chunk ${index + 1}: ${chunk.length} chars, contains "Optional": ${chunk.includes('Optional')}, contains "August": ${chunk.includes('August')}`);
  });
  
  return chunks;
}

function chunkTextBySize(text, chunkSize, overlap) {
  console.log(`🔪 Chunking text: ${text.length} chars with chunkSize=${chunkSize}, overlap=${overlap}`);
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + chunkSize);
    const slice = text.slice(start, end);
    chunks.push(slice);
    if (end === text.length) break;
    start = end - overlap;
    if (start < 0) start = 0;
  }
  console.log(`🔪 Created ${chunks.length} chunks from ${text.length} characters`);
  return chunks;
}

function toVectorLiteral(embedding) {
  return '[' + embedding.map(v => (typeof v === 'number' ? v : Number(v))).join(',') + ']';
}

export async function upsertDocument({ 
  name, 
  text, 
  countryCode, 
  originalFilename, 
  fileSize, 
  fileType, 
  language = 'en', 
  embeddingVersion = 'v2.1', 
  embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
  contentHash 
}) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    
    // Set vector_status to processing initially
    const docRes = await client.query(
      `insert into documents (
        name, country_code, original_filename, file_size, file_type, 
        language, embedding_version, embedding_model, status, vector_status, content_hash
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [
        name, 
        countryCode || null, 
        originalFilename, 
        fileSize, 
        fileType,
        language, 
        embeddingVersion, 
        embeddingModel, 
        'active', 
        'processing', 
        contentHash
      ]
    );
    const documentId = docRes.rows[0].id;
    
    console.log(`📄 Processing document: ${name} (${fileSize} bytes)`);
    const chunks = chunkText(text);
    const embeddings = await embedTexts(chunks);

    const docIds = Array(chunks.length).fill(documentId);
    const countries = Array(chunks.length).fill(countryCode || null);
    const vectorTexts = embeddings.map(e => toVectorLiteral(e));

    await client.query(
      `insert into chunks (document_id, country_code, content, embedding)
       select d, c, t, v::vector
       from (
         select * from unnest(
           $1::uuid[], $2::text[], $3::text[], $4::text[]
         ) as u(d, c, t, v)
       ) as tmp`,
      [docIds, countries, chunks, vectorTexts]
    );

    // Mark document as successfully indexed
    await client.query(
      `update documents set vector_status = 'indexed', updated_at = now() where id = $1`,
      [documentId]
    );

    await client.query('commit');
    console.log(`✅ Document indexed: ${chunks.length} chunks created`);
    return { documentId, chunksInserted: chunks.length };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

// Enhanced function to process individual files with metadata
export async function processIndividualFiles(docsDir, countryCode = 'IN') {
  const files = await fs.readdir(docsDir);
  const results = [];

  for (const file of files) {
    if (file.startsWith('.')) continue; // Skip hidden files
    
    const filePath = path.join(docsDir, file);
    const stats = await fs.stat(filePath);
    const fileSize = stats.size;
    const fileType = path.extname(file).toLowerCase();
    
    // Skip unsupported files
    if (!['.pdf', '.md', '.txt'].includes(fileType)) {
      console.log(`⏭️  Skipping unsupported file: ${file}`);
      continue;
    }

    try {
      let content = '';
      
      if (fileType === '.pdf') {
        console.log(`📄 Processing document: ${file} (${fileSize} bytes)`);
        // Parse PDF using the same method as documentParser
        const data = new Uint8Array(await fs.readFile(filePath));
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          text += pageText + '\n\n';
        }
        content = text;
        console.log(`📄 Extracted ${content.length} characters from PDF`);
      } else {
        content = await fs.readFile(filePath, 'utf8');
      }

      const contentHash = crypto.createHash('sha256').update(content).digest('hex');
      const name = path.basename(file, fileType);
      
      const result = await upsertDocument({
        name: name,
        text: content,
        countryCode,
        originalFilename: file,
        fileSize,
        fileType,
        language: 'en',
        embeddingVersion: 'v2.1',
        contentHash
      });

      results.push({
        filename: file,
        documentId: result.documentId,
        chunks: result.chunksInserted,
        size: fileSize
      });

      console.log(`✅ Processed: ${file} (${result.chunksInserted} chunks)`);
    } catch (error) {
      console.error(`❌ Error processing ${file}:`, error.message);
      
      // Mark document as error if it was created
      try {
        await pool.query(
          `update documents set vector_status = 'error', status = 'error' 
           where original_filename = $1 and created_at > now() - interval '1 hour'`,
          [file]
        );
      } catch (e) {
        console.error('Failed to mark document as error:', e.message);
      }
    }
  }

  return results;
}

export async function searchSimilar({ query, countryCode, topK = DEFAULT_TOP_K }) {
  const [queryEmbedding] = await embedTexts([query]);
  const queryVec = toVectorLiteral(queryEmbedding);
  const candidates = countryCode ? [countryCode, 'global'] : ['global'];
  
  // For holiday-related queries, increase the search scope
  // Be more specific about holiday queries to avoid false positives with leave policies
  const isHolidayQuery = /\b(holiday|holidays|festival|celebration|mandatory holiday|optional holiday|public holiday)\b/i.test(query) && 
                        !/\b(parental leave|sick leave|earned leave|casual leave|medical leave|leave policy|leave application|leave balance)\b/i.test(query);
  const searchTopK = isHolidayQuery ? Math.max(topK * 2, 15) : topK;
  
  const { rows } = await pool.query(
    `select id, document_id, country_code, content,
            1 - (embedding <#> $1::vector) as similarity
     from chunks
     where (country_code = any($2) or country_code is null)
     order by embedding <#> $1::vector asc
     limit $3`,
    [queryVec, candidates, searchTopK]
  );
  
  // For holiday queries, prioritize chunks with holiday content
  // For leave policy queries, prioritize chunks with leave content
  const isLeavePolicyQuery = /\b(parental leave|sick leave|earned leave|casual leave|medical leave|leave policy|leave application|leave balance|days.*leave|leave.*days)\b/i.test(query);
  
  if (isHolidayQuery) {
    rows.sort((a, b) => {
      const aHasHoliday = /holiday|mandatory|optional|festival/i.test(a.content);
      const bHasHoliday = /holiday|mandatory|optional|festival/i.test(b.content);
      
      if (aHasHoliday && !bHasHoliday) return -1;
      if (!aHasHoliday && bHasHoliday) return 1;
      return a.similarity - b.similarity;
    });
    
    // Return only the top K results after sorting
    return rows.slice(0, topK);
  } else if (isLeavePolicyQuery) {
    rows.sort((a, b) => {
      const aHasLeavePolicy = /\b(parental leave|sick leave|earned leave|casual leave|medical leave|leave policy|leave application|leave balance|days.*leave|leave.*days|15 days|12 days|26 weeks|30 days)\b/i.test(a.content);
      const bHasLeavePolicy = /\b(parental leave|sick leave|earned leave|casual leave|medical leave|leave policy|leave application|leave balance|days.*leave|leave.*days|15 days|12 days|26 weeks|30 days)\b/i.test(b.content);
      
      if (aHasLeavePolicy && !bHasLeavePolicy) return -1;
      if (!aHasLeavePolicy && bHasLeavePolicy) return 1;
      return a.similarity - b.similarity;
    });
    
    // Return only the top K results after sorting
    return rows.slice(0, topK);
  }
  
  return rows;
}


