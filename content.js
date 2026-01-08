// Content script for scanning Brightspace pages for files

console.log('Brightspace LLM Assistant: Content script loaded');

// Function to scan the page for files
function scanForFiles(root = document, sourceUrl = window.location.href) {
  const files = [];
  
  // Common selectors for Brightspace file links
  const fileSelectors = [
    'a[href*=".pdf"]',
    'a[href*=".docx"]',
    'a[href*=".doc"]',
    'a[href*=".txt"]',
    'a[href*=".pptx"]',
    'a[href*=".xlsx"]',
    'a.d2l-fileviewer-pdf-native',
    'a.d2l-link',
    '.d2l-fileviewer',
    'a[title*="Download"]'
  ];
  
  fileSelectors.forEach(selector => {
    const elements = root.querySelectorAll(selector);
    elements.forEach(element => {
      const href = normalizeUrl(element.getAttribute('href') || element.href, sourceUrl);
      const text = (element.textContent || '').trim();
      
      if (href && (text || element.title)) {
        const fileInfo = buildFileRecord({
          url: href,
          name: text || element.title || 'Unknown File',
          type: getFileType(href),
          foundOn: sourceUrl,
          via: 'file-scan'
        });
        
        if (!files.some(f => f.url === fileInfo.url)) {
          files.push(fileInfo);
        }
      }
    });
  });
  
  const iframes = root.querySelectorAll('iframe[src*=".pdf"], iframe[src*="/file/"]');
  iframes.forEach(iframe => {
    const src = normalizeUrl(iframe.src, sourceUrl);
    if (src) {
      const fileInfo = buildFileRecord({
        url: src,
        name: iframe.title || 'Embedded File',
        type: getFileType(src),
        foundOn: sourceUrl,
        via: 'iframe'
      });
      if (!files.some(f => f.url === fileInfo.url)) {
        files.push(fileInfo);
      }
    }
  });
  
  return files;
}

// Determine file type from URL
function getFileType(url) {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('.pdf')) return 'pdf';
  if (lowerUrl.includes('.docx') || lowerUrl.includes('.doc')) return 'document';
  if (lowerUrl.includes('.pptx') || lowerUrl.includes('.ppt')) return 'presentation';
  if (lowerUrl.includes('.xlsx') || lowerUrl.includes('.xls')) return 'spreadsheet';
  if (lowerUrl.includes('.txt')) return 'text';
  return 'unknown';
}

// Normalize relative URLs against a base URL
function normalizeUrl(rawUrl, baseUrl) {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl, baseUrl).href;
  } catch (e) {
    return rawUrl;
  }
}

// Build a consistent file record
function buildFileRecord({ url, name, type, foundOn, via }) {
  return {
    url,
    name: name || 'Unknown File',
    type: type || getFileType(url),
    foundOn: foundOn || window.location.href,
    via: via || 'unknown',
    timestamp: new Date().toISOString()
  };
}

// Heuristic to find syllabus references in a DOM root
function findSyllabusCandidates(root = document, sourceUrl = window.location.href) {
  const candidates = [];
  const selectors = 'a, button, span, div, li, h1, h2, h3, h4, h5, h6';
  const nodes = root.querySelectorAll(selectors);
  nodes.forEach(node => {
    const text = (node.textContent || '').trim().toLowerCase();
    if (!text || !text.includes('syllabus')) return;
    if (node.tagName.toLowerCase() === 'a' && node.getAttribute('href')) {
      const href = normalizeUrl(node.getAttribute('href'), sourceUrl);
      candidates.push({ kind: 'link', href, label: node.textContent.trim(), sourceUrl });
    } else {
      // Non-link text mentioning syllabus; look for nearest link inside
      const innerLink = node.querySelector('a[href]');
      if (innerLink) {
        const href = normalizeUrl(innerLink.getAttribute('href'), sourceUrl);
        candidates.push({ kind: 'link', href, label: innerLink.textContent.trim() || node.textContent.trim(), sourceUrl });
      }
    }
  });
  return candidates;
}

function isFileUrl(url) {
  const lower = url.toLowerCase();
  return ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt'].some(ext => lower.includes(ext));
}

// Try to fetch a linked page and look for syllabus there
async function fetchPageAndFindSyllabus(pageUrl) {
  try {
    const response = await fetch(pageUrl, { credentials: 'include' });
    if (!response.ok) return null;
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const linkedCandidates = findSyllabusCandidates(doc, pageUrl);
    const linkedFiles = scanForFiles(doc, pageUrl);
    const bestFile = pickBestSyllabusFile([...linkedCandidates, ...linkedFiles]);
    return bestFile;
  } catch (e) {
    console.error('Error fetching linked syllabus page', e);
    return null;
  }
}

function pickBestSyllabusFile(items) {
  // Prefer PDFs, then DOC/DOCX, otherwise any link with syllabus
  const pdf = items.find(item => item.href && isFileUrl(item.href) && item.href.toLowerCase().includes('.pdf'));
  if (pdf) return buildFileRecord({ url: pdf.href, name: pdf.label || 'Syllabus', via: 'syllabus-link' });
  const doc = items.find(item => item.href && isFileUrl(item.href));
  if (doc) return buildFileRecord({ url: doc.href, name: doc.label || 'Syllabus', via: 'syllabus-link' });
  const scanned = items.find(item => item.url && isFileUrl(item.url));
  if (scanned) return buildFileRecord({ url: scanned.url, name: scanned.name || 'Syllabus', via: scanned.via || 'scan' });
  return null;
}

// Main syllabus finder
async function findSyllabus() {
  const directCandidates = findSyllabusCandidates(document, window.location.href);
  const directFiles = scanForFiles(document, window.location.href);
  let syllabusFile = pickBestSyllabusFile([...directCandidates, ...directFiles]);

  if (syllabusFile) {
    return syllabusFile;
  }

  // If we saw syllabus links that are pages, follow them
  for (const candidate of directCandidates) {
    if (candidate.href && !isFileUrl(candidate.href)) {
      const linked = await fetchPageAndFindSyllabus(candidate.href);
      if (linked) return linked;
    }
  }

  return null;
}

// Extract course information from the page
function extractCourseInfo() {
  const courseInfo = {
    courseName: '',
    courseCode: '',
    semester: ''
  };
  
  // Try to find course name in common locations
  const titleElement = document.querySelector('.d2l-navigation-s-course-name, .d2l-course-name, h1.d2l-heading');
  if (titleElement) {
    courseInfo.courseName = titleElement.textContent.trim();
  }
  
  // Try to extract course code
  const codeMatch = courseInfo.courseName.match(/[A-Z]{2,4}\s*\d{3,4}/);
  if (codeMatch) {
    courseInfo.courseCode = codeMatch[0];
  }
  
  return courseInfo;
}

// Load PDF.js for content script rendering
let pdfjsLib = null;
const pdfScriptUrl = chrome.runtime.getURL('pdf.min.js');
const workerScriptUrl = chrome.runtime.getURL('pdf.worker.min.js');

async function loadPdfJs() {
  if (pdfjsLib) return; // Already loaded
  
  try {
    // Load the main library
    const script = document.createElement('script');
    script.src = pdfScriptUrl;
    document.head.appendChild(script);
    
    // Wait for pdfjsLib to be available
    await new Promise((resolve, reject) => {
      const maxWait = 5000;
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (window.pdfjsLib) {
          clearInterval(checkInterval);
          pdfjsLib = window.pdfjsLib;
          // Set worker source
          pdfjsLib.GlobalWorkerOptions.workerSrc = workerScriptUrl;
          console.log('✓ PDF.js loaded in content script with worker at:', workerScriptUrl);
          resolve();
        } else if (Date.now() - startTime > maxWait) {
          clearInterval(checkInterval);
          reject(new Error('PDF.js failed to load within timeout'));
        }
      }, 100);
    });
  } catch (error) {
    console.error('Failed to load PDF.js in content script:', error);
  }
}

// Listen for messages from popup or background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scanPage') {
    (async () => {
      const files = scanForFiles();
      const courseInfo = extractCourseInfo();
      const syllabusFile = await findSyllabus();
      
      // Store files and syllabus in chrome.storage
      chrome.storage.local.get(['scannedFiles'], (result) => {
        const existingFiles = result.scannedFiles || [];
        const allFiles = [...existingFiles, ...files];
        const uniqueFiles = Array.from(new Map(allFiles.map(file => [file.url, file])).values());
        const storageData = { scannedFiles: uniqueFiles };
        if (syllabusFile) storageData.syllabusFile = syllabusFile;
        chrome.storage.local.set(storageData);
      });

      sendResponse({
        success: true,
        files: files,
        courseInfo: courseInfo,
        pageUrl: window.location.href,
        syllabus: syllabusFile || null
      });
    })();
  } else if (request.action === 'convertPDFToImages') {
    // Handle PDF-to-canvas conversion with proper DOM access
    (async () => {
      try {
        const { pdfDataUrl, fileName } = request;
        
        // Ensure PDF.js is loaded in content script context
        await loadPdfJs();
        
        if (!pdfjsLib) {
          throw new Error('PDF.js not available in content script');
        }
        
        console.log(`Converting PDF to images: ${fileName}`);
        
        // Fetch the PDF data
        const response = await fetch(pdfDataUrl);
        const arrayBuffer = await response.arrayBuffer();
        
        // Load PDF document
        const loadingTask = pdfjsLib.getDocument({ 
          data: arrayBuffer,
          useWorkerFetch: false,
          useRangeRequests: false
        });
        
        const pdf = await loadingTask.promise;
        console.log(`PDF loaded: ${pdf.numPages} pages`);
        
        const images = [];
        const maxPages = Math.min(pdf.numPages, 20); // Limit to 20 pages
        
        // Render each page to canvas
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
          try {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 2 }); // 2x scale for better quality
            
            // Create canvas with proper dimensions
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            
            const context = canvas.getContext('2d');
            const renderTask = page.render({
              canvasContext: context,
              viewport: viewport
            });
            
            await renderTask.promise;
            
            // Convert to JPEG data URL
            const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
            images.push({
              dataUrl: imageDataUrl,
              pageNum: pageNum,
              fileName: fileName
            });
            
            console.log(`✓ Page ${pageNum} rendered to image`);
          } catch (pageError) {
            console.warn(`Error rendering page ${pageNum}:`, pageError);
          }
        }
        
        console.log(`✓ Converted ${images.length} pages to images`);
        sendResponse({
          success: true,
          images: images
        });
      } catch (error) {
        console.error('Error converting PDF to images:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
    })();
    return true; // Keep channel open for async response
  }
  
  return true; // Keep message channel open for async response
});

// Auto-scan on page load
window.addEventListener('load', () => {
  setTimeout(() => {
    const files = scanForFiles();
    if (files.length > 0) {
      console.log(`Found ${files.length} files on this page`);
      chrome.storage.local.get(['scannedFiles'], (result) => {
        const existingFiles = result.scannedFiles || [];
        const allFiles = [...existingFiles, ...files];
        const uniqueFiles = Array.from(new Map(allFiles.map(file => [file.url, file])).values());
        chrome.storage.local.set({ scannedFiles: uniqueFiles });
      });
    }
    // Opportunistically store syllabus on load if found
    findSyllabus().then(syllabus => {
      if (syllabus) {
        chrome.storage.local.set({ syllabusFile: syllabus });
      }
    });
  }, 2000); // Wait for dynamic content to load
});
