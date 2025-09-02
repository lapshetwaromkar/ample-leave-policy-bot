import { Router } from 'express';
import { pool, requireAdmin } from '../db.js';
import path from 'path';
import fs from 'fs/promises';
import multer from 'multer';
import { upsertDocument } from '../rag.js';
import crypto from 'crypto';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const docsDir = path.join(process.cwd(), 'docs');
    cb(null, docsDir);
  },
  filename: (req, file, cb) => {
    // Use original filename but sanitize it
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, sanitized);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Only allow PDF, MD, and TXT files
    const allowedTypes = ['.pdf', '.md', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed. Only PDF, MD, and TXT files are supported.`));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// Utility function to format file size
function formatFileSize(bytes) {
  if (!bytes) return null;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

// IMPLEMENTED: Documents list with chunk counts (basic filters)
// GET /admin/docs?search=&country_code=&language=&embedding_version=&staleness=&from=&to=&page=&limit=
router.get('/admin/docs', requireAdmin, async (req, res) => {
  try {
    const { search = '', country_code, page='1', limit='20' } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
    const off = (pageNum - 1) * lim;

    const params = [];
    const where = [];
    if (search) { params.push(`%${search}%`); where.push(`d.name ilike $${params.length}`); }
    if (country_code) { params.push(country_code); where.push(`d.country_code = $${params.length}`); }
    const whereSql = where.length ? 'where ' + where.join(' and ') : '';

    const { rows } = await pool.query(
      `select 
         d.id, 
         d.name, 
         d.original_filename,
         d.file_size,
         d.file_type,
         d.language,
         d.embedding_version,
         d.embedding_model,
         d.status,
         d.vector_status,
         d.country_code, 
         d.updated_at,
         count(c.id) as chunks
       from documents d
       left join chunks c on c.document_id = d.id
       ${whereSql}
       group by d.id, d.name, d.original_filename, d.file_size, d.file_type, 
                d.language, d.embedding_version, d.embedding_model, d.status, 
                d.vector_status, d.country_code, d.updated_at
       order by updated_at desc
       limit ${lim} offset ${off}`,
      params
    );
    
    // Format the response data
    const formattedResults = rows.map(row => ({
      id: row.id,
      name: row.name,
      original_filename: row.original_filename,
      file_size: formatFileSize(row.file_size),
      file_size_bytes: row.file_size,
      file_type: row.file_type,
      language: row.language,
      embedding_version: row.embedding_version,
      embedding_model: row.embedding_model,
      status: row.status,
      vector_status: row.vector_status,
      country_code: row.country_code,
      updated_at: row.updated_at,
      chunks: row.chunks
    }));
    
    res.json({ 
      page: pageNum, 
      limit: lim, 
      results: formattedResults 
    });
  } catch (e) {
    res.status(500).json({ error: 'failed_to_list_documents', detail: e.message });
  }
});

// Helper function to parse PDF content
async function parsePDFContent(filePath) {
  try {
    const data = new Uint8Array(await fs.readFile(filePath));
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map(item => item.str).join(' ');
      text += pageText + '\n\n';
    }
    
    return text;
  } catch (error) {
    throw new Error(`PDF parsing failed: ${error.message}`);
  }
}

// POST Upload Document - Upload file and process for RAG
router.post('/admin/docs/upload', requireAdmin, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'no_file_uploaded' });
    }
    
    const { 
      country_code = 'IN', 
      language = 'en',
      name: customName 
    } = req.body;
    
    const file = req.file;
    const filePath = file.path;
    const fileExt = path.extname(file.originalname).toLowerCase();
    const fileName = customName || path.basename(file.originalname, fileExt);
    
    console.log(`📤 Processing uploaded file: ${file.originalname} (${file.size} bytes)`);
    
    // Read and parse file content
    let content = '';
    if (fileExt === '.pdf') {
      content = await parsePDFContent(filePath);
    } else {
      content = await fs.readFile(filePath, 'utf8');
    }
    
    // Generate content hash
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    
    // Check if document with same hash already exists
    const { rows: existingDocs } = await pool.query(
      'SELECT id, name FROM documents WHERE content_hash = $1',
      [contentHash]
    );
    
    if (existingDocs.length > 0) {
      // Delete uploaded file since it's a duplicate
      await fs.unlink(filePath);
      return res.status(409).json({ 
        error: 'duplicate_document',
        message: 'Document with same content already exists',
        existing_document: existingDocs[0]
      });
    }
    
    // Process document with RAG
    const result = await upsertDocument({
      name: fileName,
      text: content,
      countryCode: country_code,
      originalFilename: file.originalname,
      fileSize: file.size,
      fileType: fileExt,
      language,
      embeddingVersion: 'v2.1',
      contentHash
    });
    
    res.json({
      success: true,
      message: 'Document uploaded and processed successfully',
      document: {
        id: result.documentId,
        name: fileName,
        original_filename: file.originalname,
        file_size: formatFileSize(file.size),
        file_size_bytes: file.size,
        file_type: fileExt,
        language,
        country_code,
        chunks_created: result.chunksInserted,
        status: 'active',
        vector_status: 'indexed'
      }
    });
    
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.warn('Failed to cleanup uploaded file:', unlinkError.message);
      }
    }
    
    console.error('Document upload error:', error);
    res.status(500).json({ 
      error: 'upload_failed', 
      detail: error.message 
    });
  }
});

// DELETE Document - Remove from vector database and optionally delete file
router.delete('/admin/docs/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { deleteFile = false } = req.query; // Option to delete physical file
    
    // Get document info before deletion
    const { rows: docRows } = await pool.query(
      'SELECT original_filename FROM documents WHERE id = $1',
      [id]
    );
    
    if (docRows.length === 0) {
      return res.status(404).json({ error: 'document_not_found' });
    }
    
    const document = docRows[0];
    
    // Delete from vector database (cascades to chunks)
    const { rows: deletedRows } = await pool.query(
      'DELETE FROM documents WHERE id = $1 RETURNING *',
      [id]
    );
    
    // Optionally delete physical file
    if (deleteFile && document.original_filename) {
      try {
        const filePath = path.join(process.cwd(), 'docs', document.original_filename);
        await fs.unlink(filePath);
        console.log(`🗑️  Deleted file: ${document.original_filename}`);
      } catch (fileError) {
        console.warn(`⚠️  Could not delete file ${document.original_filename}:`, fileError.message);
      }
    }
    
    res.json({ 
      success: true, 
      deleted_document: deletedRows[0],
      file_deleted: deleteFile,
      message: `Document deleted successfully${deleteFile ? ' (including file)' : ''}`
    });
    
  } catch (e) {
    res.status(500).json({ error: 'failed_to_delete_document', detail: e.message });
  }
});

// GET Files in docs directory - List actual physical files
router.get('/admin/docs/files', requireAdmin, async (req, res) => {
  try {
    const docsDir = path.join(process.cwd(), 'docs');
    
    // Check if docs directory exists
    try {
      await fs.access(docsDir);
    } catch (error) {
      return res.json({ 
        success: true,
        directory: docsDir,
        files: [],
        message: 'Docs directory does not exist'
      });
    }
    
    const files = await fs.readdir(docsDir);
    const fileDetails = [];
    
    for (const file of files) {
      if (file.startsWith('.')) continue; // Skip hidden files
      
      const filePath = path.join(docsDir, file);
      const stats = await fs.stat(filePath);
      
      if (stats.isFile()) {
        const ext = path.extname(file).toLowerCase();
        
        // Check if this file is indexed in RAG
        const { rows: ragDocs } = await pool.query(
          'SELECT id, name, status, vector_status, chunks FROM (SELECT d.id, d.name, d.status, d.vector_status, count(c.id) as chunks FROM documents d LEFT JOIN chunks c ON c.document_id = d.id WHERE d.original_filename = $1 GROUP BY d.id, d.name, d.status, d.vector_status) as doc_info',
          [file]
        );
        
        fileDetails.push({
          filename: file,
          file_path: filePath,
          file_size: formatFileSize(stats.size),
          file_size_bytes: stats.size,
          file_type: ext,
          last_modified: stats.mtime,
          is_supported: ['.pdf', '.md', '.txt'].includes(ext),
          rag_indexed: ragDocs.length > 0,
          rag_document: ragDocs.length > 0 ? ragDocs[0] : null
        });
      }
    }
    
    // Sort by last modified (newest first)
    fileDetails.sort((a, b) => new Date(b.last_modified) - new Date(a.last_modified));
    
    res.json({
      success: true,
      directory: docsDir,
      total_files: fileDetails.length,
      supported_files: fileDetails.filter(f => f.is_supported).length,
      indexed_files: fileDetails.filter(f => f.rag_indexed).length,
      files: fileDetails
    });
    
  } catch (error) {
    res.status(500).json({ 
      error: 'failed_to_list_files', 
      detail: error.message 
    });
  }
});

export default router;


