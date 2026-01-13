// Offscreen document for PDF rendering (has DOM access)
// This runs in a hidden document context where we CAN use document.createElement

console.log('=== OFFSCREEN DOCUMENT LOADED ===');
console.log('Timestamp:', new Date().toISOString());
console.log('Location:', window.location.href);
console.log('Has document?', typeof document !== 'undefined');
console.log('Has pdfjsLib?', typeof pdfjsLib !== 'undefined');
console.log('Has chrome.runtime?', typeof chrome?.runtime !== 'undefined');

// Set up PDF.js
if (typeof pdfjsLib !== 'undefined') {
  try {
    const workerUrl = chrome.runtime.getURL('pdf.worker.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    console.log('✓ PDF.js configured in offscreen document');
    console.log('Worker URL:', workerUrl);
  } catch (error) {
    console.error('Failed to configure PDF.js:', error);
  }
} else {
  console.error('❌ PDF.js not available in offscreen document!');
  console.error('Check if pdf.min.js loaded properly');
}

// Test document access
try {
  const testCanvas = document.createElement('canvas');
  console.log('✓ Can create canvas elements:', testCanvas !== null);
} catch (e) {
  console.error('❌ Cannot create canvas:', e);
}

// Listen for messages from background script
console.log('Setting up message listener...');
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') {
    return false;
  }
  console.log('=== OFFSCREEN RECEIVED MESSAGE ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Action:', message.action);
  
  // Handle Ping (Handshake)
  if (message.action === 'ping') {
    console.log('Ping received, sending pong');
    sendResponse({ success: true, message: 'pong' });
    return false; // Sync response
  }

  if (message.action === 'convertPDFToImages') {
    console.log('Starting PDF conversion for:', message.fileName);
    console.log('Data URL length:', message.pdfDataUrl?.length || 0);
    
    handlePDFConversion(message.pdfDataUrl, message.fileName)
      .then(images => {
        console.log(`✓ Offscreen converted PDF to ${images.length} images`);
        sendResponse({ success: true, images });
      })
      .catch(error => {
        console.error('Offscreen PDF conversion error:', error);
        console.error('Error stack:', error.stack);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async
  }

  if (message.action === 'extractPDFText') {
    console.log('Starting PDF text extraction for:', message.fileName || 'unknown');
    extractPDFTextFromMessage(message)
      .then(text => {
        console.log(`✓ Offscreen extracted ${text.length} chars of PDF text`);
        sendResponse({ success: true, text });
      })
      .catch(error => {
        console.error('Offscreen PDF text extraction error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
  
  console.warn('Unknown action received:', message.action);
  sendResponse({ success: false, error: 'Unknown action: ' + message.action });
  return false;
});

console.log('✓ Message listener registered');
console.log('=== OFFSCREEN INITIALIZATION COMPLETE ===');

let port = null;

function connectOffscreenPort() {
  if (port) return;

  port = chrome.runtime.connect({ name: 'pdf-offscreen' });
  port.postMessage({ type: 'ready' });
  console.log('✓ Offscreen port ready');

  port.onMessage.addListener((message) => {
    if (message?.type === 'ping') {
      port.postMessage({ type: 'ready' });
      return;
    }

    if (message?.action === 'convertPDFToImages') {
      handlePDFConversionStream(message)
        .catch(error => {
          port.postMessage({
            type: 'error',
            requestId: message.requestId,
            error: error.message
          });
        });
    }
  });

  port.onDisconnect.addListener(() => {
    console.warn('Offscreen port disconnected, retrying...');
    port = null;
    setTimeout(connectOffscreenPort, 500);
  });
}

connectOffscreenPort();

async function ensurePdfJsReady() {
  if (typeof pdfjsLib !== 'undefined') {
    return pdfjsLib;
  }

  const maxWaitMs = 5000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    if (typeof pdfjsLib !== 'undefined') {
      return pdfjsLib;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  throw new Error('PDF.js not available in offscreen document');
}

async function handlePDFConversionStream(message) {
  const { pdfDataUrl, fileName, requestId } = message;
  console.log(`Converting PDF to images in offscreen: ${fileName}`);

  await ensurePdfJsReady();

  const response = await fetch(pdfDataUrl);
  const arrayBuffer = await response.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    disableWorker: true,
    useWorkerFetch: false,
    useRangeRequests: false
  });

  const pdf = await loadingTask.promise;
  console.log(`PDF loaded: ${pdf.numPages} pages`);

  const maxPages = Math.min(pdf.numPages, 8);

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    try {
      port.postMessage({ type: 'progress', requestId, pageNum });
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.2 });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const context = canvas.getContext('2d');
      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport
      });

      await renderTask.promise;

      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.6);
      if (!imageDataUrl || imageDataUrl.length < 50) {
        console.warn('Skipping empty offscreen image for page', pageNum);
        continue;
      }

      port.postMessage({
        type: 'page',
        requestId,
        image: {
          dataUrl: imageDataUrl,
          pageNum,
          fileName
        }
      });

      console.log(`✓ Page ${pageNum}/${maxPages} rendered`);
    } catch (pageError) {
      console.warn(`Error rendering page ${pageNum}:`, pageError);
    }
  }

  port.postMessage({ type: 'done', requestId });
}

async function handlePDFConversion(pdfDataUrl, fileName) {
  try {
    console.log(`Converting PDF to images in offscreen: ${fileName}`);

    await ensurePdfJsReady();
    
    // Fetch the PDF data
    const response = await fetch(pdfDataUrl);
    const arrayBuffer = await response.arrayBuffer();
    
    // Load PDF document
    const loadingTask = pdfjsLib.getDocument({ 
      data: arrayBuffer,
      disableWorker: true,
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
        
        // Create canvas with proper dimensions (DOM access works here!)
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
        
        console.log(`✓ Page ${pageNum}/${maxPages} rendered`);
      } catch (pageError) {
        console.warn(`Error rendering page ${pageNum}:`, pageError);
      }
    }
    
    return images;
  } catch (error) {
    console.error('PDF conversion failed:', error);
    throw error;
  }
}

async function extractPDFTextFromMessage(message) {
  await ensurePdfJsReady();

  let arrayBuffer;
  if (message.arrayBuffer) {
    arrayBuffer = message.arrayBuffer;
  } else if (message.pdfDataUrl) {
    const response = await fetch(message.pdfDataUrl);
    arrayBuffer = await response.arrayBuffer();
  } else {
    throw new Error('No PDF data provided');
  }

  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    disableWorker: true,
    useWorkerFetch: false,
    useRangeRequests: false
  });

  const pdf = await loadingTask.promise;
  console.log(`PDF loaded: ${pdf.numPages} pages`);

  const maxPages = Math.min(pdf.numPages, 20);
  let fullText = '';

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map(item => item.str)
        .join(' ');
      fullText += `\n\n--- Page ${pageNum} ---\n${pageText}`;
    } catch (pageError) {
      console.warn(`Error extracting page ${pageNum}:`, pageError);
    }
  }

  return fullText.trim();
}
