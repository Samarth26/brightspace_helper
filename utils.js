/**
 * PDF.js integration for text extraction
 * This file should be included when pdf.js library is added to the extension
 */

// Include pdf.js library:
// Add to manifest.json web_accessible_resources:
// "js/pdf.min.js"

async function extractTextFromPDFAdvanced(url) {
  try {
    // Fetch the PDF
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    
    // Initialize PDF.js
    if (typeof pdfjsLib === 'undefined') {
      return 'PDF.js library not loaded. Please add it to the extension.';
    }
    
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    // Extract text from all pages
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }
    
    return fullText;
  } catch (error) {
    console.error('Error extracting PDF with pdf.js:', error);
    return null;
  }
}

/**
 * Document text extraction utilities
 */

async function extractTextFromWord(url) {
  // For .docx files, use mammoth.js or similar library
  try {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    
    // If mammoth.js is available
    if (typeof mammoth !== 'undefined') {
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    }
    
    return 'Word document parsing requires mammoth.js library.';
  } catch (error) {
    console.error('Error extracting Word document:', error);
    return null;
  }
}

async function extractTextFromTxt(url) {
  try {
    const response = await fetch(url);
    const text = await response.text();
    return text;
  } catch (error) {
    console.error('Error extracting text file:', error);
    return null;
  }
}

/**
 * Text preprocessing for LLM
 */

function preprocessText(text) {
  if (!text) return '';
  
  // Remove extra whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  // Remove URLs
  text = text.replace(/https?:\/\/\S+/g, '');
  
  // Remove email addresses
  text = text.replace(/\S+@\S+/g, '');
  
  // Keep line breaks for formatting but normalize them
  text = text.replace(/\n\s*\n/g, '\n\n');
  
  return text;
}

/**
 * Text chunking for large documents
 * This helps when sending to LLM with token limits
 */

function chunkText(text, chunkSize = 2000, overlap = 200) {
  const chunks = [];
  
  for (let i = 0; i < text.length; i += (chunkSize - overlap)) {
    chunks.push(text.substring(i, i + chunkSize));
  }
  
  return chunks;
}

/**
 * Summarize text to fit within token limits
 */

async function summarizeText(text, maxLength = 1000) {
  if (text.length <= maxLength) {
    return text;
  }
  
  // Simple summarization: take first and last parts plus sentences with keywords
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  
  const keywords = ['deadline', 'assignment', 'exam', 'grade', 'submit', 'due', 'requirement', 'policy'];
  const importantSentences = sentences.filter(s => 
    keywords.some(k => s.toLowerCase().includes(k))
  );
  
  let summary = sentences.slice(0, 2).join('') + ' ';
  summary += importantSentences.slice(0, 5).join('') + ' ';
  summary += sentences.slice(-2).join('');
  
  return summary.substring(0, maxLength);
}

/**
 * Context preparation for specific query types
 */

function prepareContextForQuery(fullText, queryType) {
  const queries = {
    'deadline': [
      'deadline', 'due', 'submission', 'date', 'time', 'by', 'before',
      'assignment', 'project', 'exam', 'quiz'
    ],
    'grading': [
      'grade', 'points', 'percentage', 'rubric', 'criteria', 'score',
      'weight', 'weighted', 'gpa', 'curve'
    ],
    'learning_objectives': [
      'objective', 'goal', 'learn', 'understand', 'knowledge', 'skill',
      'competency', 'outcome', 'should be able'
    ],
    'requirements': [
      'require', 'must', 'should', 'mandatory', 'necessary', 'prerequisite',
      'needed', 'need', 'include'
    ],
    'policy': [
      'policy', 'plagiarism', 'honor', 'attendance', 'participation',
      'late', 'extension', 'accommodate', 'disability'
    ]
  };
  
  const relevantKeywords = queries[queryType] || [];
  
  // Find sentences containing relevant keywords
  const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [];
  const relevantSentences = sentences.filter(s =>
    relevantKeywords.some(k => s.toLowerCase().includes(k))
  );
  
  if (relevantSentences.length > 0) {
    return relevantSentences.join(' ');
  }
  
  return fullText;
}

export {
  extractTextFromPDFAdvanced,
  extractTextFromWord,
  extractTextFromTxt,
  preprocessText,
  chunkText,
  summarizeText,
  prepareContextForQuery
};
