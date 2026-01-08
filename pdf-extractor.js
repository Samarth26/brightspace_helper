// PDF text extraction using PDF.js from CDN
// This will be loaded in the background service worker

let pdfjsLib = null;

async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  
  try {
    // Import PDF.js from CDN
    importScripts('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    pdfjsLib = window.pdfjsLib || globalThis.pdfjsLib;
    
    if (pdfjsLib) {
      // Set worker source
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      console.log('PDF.js loaded successfully');
      return pdfjsLib;
    }
  } catch (error) {
    console.error('Failed to load PDF.js:', error);
  }
  return null;
}

async function extractTextFromPDF(arrayBuffer) {
  try {
    const lib = await loadPdfJs();
    if (!lib) {
      throw new Error('PDF.js not available');
    }
    
    const loadingTask = lib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    console.log(`PDF loaded: ${pdf.numPages} pages`);
    
    let fullText = '';
    
    // Extract text from each page
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += `\n\n--- Page ${pageNum} ---\n${pageText}`;
    }
    
    console.log(`Extracted ${fullText.length} characters from PDF`);
    return fullText.trim();
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw error;
  }
}

// Make available globally
globalThis.extractTextFromPDF = extractTextFromPDF;
