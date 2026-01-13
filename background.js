// Background service worker for Brightspace LLM Assistant
// Enhanced version with retry logic and better error handling

console.log('Background service worker loaded at', new Date().toISOString());

self.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection in service worker:', event.reason);
});

self.addEventListener('error', (event) => {
  console.error('Unhandled error in service worker:', event.message || event.error);
});

// Load PDF.js for PDF text extraction
let pdfjsLib = null;

try {
  importScripts('pdf.min.js');
  pdfjsLib = globalThis.pdfjsLib;
  if (pdfjsLib) {
    // In service worker, set workerSrc to the worker file
    // Using absolute URL is safer
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf.worker.min.js');
      console.log('✓ PDF.js loaded with workerSrc set to:', pdfjsLib.GlobalWorkerOptions.workerSrc);
    } catch (e) {
      console.warn('Could not set workerSrc with getURL, fallback to relative:', e);
      // Try relative path
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
        console.log('✓ PDF.js worker set to relative path');
      } catch (workerError) {
        console.error('Failed to set worker path:', workerError);
      }
    }
  }
} catch (error) {
  console.error('Failed to load PDF.js:', error);
  console.log('PDF extraction will be limited');
}

// Helper to ensure offscreen document exists for PDF rendering
async function ensureOffscreenDocument() {
  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  
  if (existingContexts.length === 0) {
    // Create offscreen document
    try {
      await chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('offscreen.html'),
        reasons: ['DOM_SCRAPING'], // We need DOM access for canvas
        justification: 'PDF rendering requires canvas element creation'
      });
      
      console.log('✓ Offscreen document created for PDF rendering');
    } catch (error) {
      console.error('Failed to create offscreen document:', error);
      throw error;
    }
  }
  
  // Wait for offscreen to be ready (handshake)
  // This ensures the message listener is registered before we send real work
  const maxRetries = 20; // Wait up to 10 seconds
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'ping' }, (res) => {
          if (chrome.runtime.lastError) {
             resolve(null);
          } else {
             resolve(res);
          }
        });
      });
      
      if (response && response.success && response.message === 'pong') {
        console.log('✓ Offscreen document is ready and responding');
        return; // Success!
      }
    } catch (e) {
      // Ignore and retry
    }
    // Wait 500ms before retry
    await new Promise(r => setTimeout(r, 500));
  }
  
  console.warn('Offscreen document did not respond to ping, but continuing anyway...');
}

// Helper to send messages to offscreen document
async function sendMessageToOffscreen(message) {
  try {
    await ensureOffscreenDocument();
    
    console.log('Sending message to offscreen document:', message.action);
    
    // Add timeout to prevent hanging (increased to 60s for large files)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Offscreen document timeout after 60s')), 60000);
    });
    
    const messagePromise = new Promise((resolve, reject) => {
      console.log('Calling chrome.runtime.sendMessage...');
    chrome.runtime.sendMessage({ ...message, target: 'offscreen' }, (response) => {
        console.log('Got response from sendMessage:', response ? 'Response received' : 'No response');
        
        if (chrome.runtime.lastError) {
          console.error('Runtime error from offscreen:', chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!response) {
          // Sometimes sendMessage returns undefined if port closes, but lastError is set. 
          // If lastError NOT set and response undefined, it means connection closed prematurely?
          reject(new Error('No response from offscreen document'));
        } else if (!response.success) {
          console.error('Offscreen returned error:', response.error);
          reject(new Error(response.error || 'Offscreen document failed'));
        } else {
          if (typeof response.text === 'string') {
            console.log(`✓ Received ${response.text.length} chars from offscreen`);
            resolve(response.text);
            return;
          }
          console.log(`✓ Received ${response.images?.length || 0} images from offscreen`);
          resolve(response.images);
        }
      });
    });
    
    return await Promise.race([messagePromise, timeoutPromise]);
  } catch (error) {
    console.error('Failed to communicate with offscreen document:', error);
    throw error;
  }
}

// Dedicated renderer tab + port for PDF conversion
let rendererPort = null;
let rendererTabId = null;
let rendererReadyPromise = null;
let rendererReadyResolve = null;
let rendererReadyReject = null;
let rendererReadyTimeoutId = null;
const pendingRenderRequests = new Map();
let offscreenPort = null;
let offscreenReadyPromise = null;
let offscreenReadyResolve = null;
let offscreenReadyReject = null;
let offscreenReadyTimeoutId = null;
const pendingOffscreenRequests = new Map();
let offscreenReady = false;

function markOffscreenReady() {
  offscreenReady = true;
  if (offscreenReadyTimeoutId) {
    clearTimeout(offscreenReadyTimeoutId);
    offscreenReadyTimeoutId = null;
  }
  if (offscreenReadyResolve) {
    offscreenReadyResolve();
    offscreenReadyResolve = null;
    offscreenReadyReject = null;
    offscreenReadyPromise = null;
  }
}

function arrayBufferToDataUrl(buffer, mimeType) {
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('Empty image buffer');
  }
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return `data:${mimeType};base64,${base64}`;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'pdf-offscreen') {
    offscreenPort = port;
    console.log('✓ Offscreen port connected');
    markOffscreenReady();

    port.onMessage.addListener((message) => {
      if (message?.type === 'ready') {
        markOffscreenReady();
        return;
      }

      const { requestId } = message || {};
      if (!requestId || !pendingOffscreenRequests.has(requestId)) return;

      const pending = pendingOffscreenRequests.get(requestId);
      if (pending.resetTimeout) pending.resetTimeout();
      if (message.type === 'progress') {
        return;
      }

      if (message.type === 'page' && message.image) {
        const image = message.image;
        if (image.dataUrl && typeof image.dataUrl === 'string' && image.dataUrl.length > 50) {
          pending.images.push(image);
        } else {
          console.warn('Skipping empty offscreen data URL for page', image.pageNum);
        }
        return;
      }

      if (message.type === 'done') {
        pending.done = true;
        if (pending.inflight === 0) {
          pendingOffscreenRequests.delete(requestId);
          pending.resolve(pending.images);
        }
        return;
      }

      if (message.type === 'error') {
        pendingOffscreenRequests.delete(requestId);
        pending.reject(new Error(message.error || 'Offscreen renderer failed'));
      }
    });

    port.onDisconnect.addListener(() => {
      for (const pending of pendingOffscreenRequests.values()) {
        pending.reject(new Error('Offscreen renderer disconnected'));
      }
      pendingOffscreenRequests.clear();
      offscreenPort = null;
      offscreenReady = false;
    });
    return;
  }

  if (port.name !== 'pdf-renderer') return;

  rendererPort = port;
  rendererTabId = port.sender?.tab?.id ?? rendererTabId;

  port.onMessage.addListener((message) => {
    if (message?.type === 'error' && !message.requestId) {
      if (rendererReadyTimeoutId) {
        clearTimeout(rendererReadyTimeoutId);
        rendererReadyTimeoutId = null;
      }
      if (rendererReadyReject) {
        rendererReadyReject(new Error(message.error || 'Renderer tab failed to initialize'));
        rendererReadyResolve = null;
        rendererReadyReject = null;
        rendererReadyPromise = null;
      }
      return;
    }

    if (message?.type === 'ready') {
      if (rendererReadyTimeoutId) {
        clearTimeout(rendererReadyTimeoutId);
        rendererReadyTimeoutId = null;
      }
      if (rendererReadyResolve) {
        rendererReadyResolve();
        rendererReadyResolve = null;
        rendererReadyReject = null;
        rendererReadyPromise = null;
      }
      return;
    }

    const { requestId } = message || {};
    if (!requestId || !pendingRenderRequests.has(requestId)) return;

    const pending = pendingRenderRequests.get(requestId);
    if (pending.resetTimeout) pending.resetTimeout();
    if (message.type === 'page' && message.image) {
      const image = message.image;
      if (image.buffer) {
        pending.inflight += 1;
        const buffer = image.buffer;
        const mimeType = image.mimeType || 'image/jpeg';
        Promise.resolve()
          .then(() => arrayBufferToDataUrl(buffer, mimeType))
          .then((dataUrl) => {
            pending.images.push({
              dataUrl,
              pageNum: image.pageNum,
              fileName: image.fileName
            });
          })
          .catch((err) => {
            console.warn('Failed to decode renderer image buffer:', err);
          })
          .finally(() => {
            pending.inflight -= 1;
            if (pending.done && pending.inflight === 0) {
              pendingRenderRequests.delete(requestId);
              pending.resolve(pending.images);
            }
          });
        return;
      }

      if (image.dataUrl) {
        if (typeof image.dataUrl === 'string' && image.dataUrl.length > 50) {
          pending.images.push(image);
        } else {
          console.warn('Skipping empty renderer data URL for page', image.pageNum);
        }
        return;
      }
    }

    if (message.type === 'done') {
      pending.done = true;
      if (pending.inflight === 0) {
        pendingRenderRequests.delete(requestId);
        pending.resolve(pending.images);
      }
      return;
    }

    if (message.type === 'error') {
      pendingRenderRequests.delete(requestId);
      pending.reject(new Error(message.error || 'Renderer tab failed'));
    }
  });

  port.onDisconnect.addListener(() => {
    for (const pending of pendingRenderRequests.values()) {
      pending.reject(new Error('Renderer tab disconnected'));
    }
    pendingRenderRequests.clear();
    rendererPort = null;
    rendererTabId = null;
  });
});

async function ensureRendererTab() {
  if (rendererPort) return;

  if (!rendererReadyPromise) {
    rendererReadyPromise = new Promise((resolve, reject) => {
      rendererReadyResolve = resolve;
      rendererReadyReject = reject;
    });

    const url = chrome.runtime.getURL('renderer.html');
    const existingTabs = await chrome.tabs.query({ url });
    if (existingTabs && existingTabs.length > 0) {
      rendererTabId = existingTabs[0].id;
      await chrome.tabs.reload(rendererTabId);
    } else {
      const tab = await chrome.tabs.create({ url, active: false });
      rendererTabId = tab.id;
    }

    rendererReadyTimeoutId = setTimeout(() => {
      if (rendererReadyReject) {
        rendererReadyReject(new Error('Renderer tab did not become ready'));
      }
      rendererReadyPromise = null;
      rendererReadyResolve = null;
      rendererReadyReject = null;
      rendererReadyTimeoutId = null;
    }, 15000);
  }

  await rendererReadyPromise;
}

async function sendMessageToRenderer(message) {
  await ensureRendererTab();

  if (!rendererPort) {
    throw new Error('Renderer tab port not available');
  }

  const requestId = `render-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const images = [];

  let timeoutId = null;
  const responsePromise = new Promise((resolve, reject) => {
    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        pendingRenderRequests.delete(requestId);
        reject(new Error('Renderer tab timeout after 120s'));
      }, 120000);
    };

    pendingRenderRequests.set(requestId, {
      resolve,
      reject,
      images,
      inflight: 0,
      done: false,
      resetTimeout
    });

    resetTimeout();
  });

  rendererPort.postMessage({
    ...message,
    requestId
  });

  try {
    return await responsePromise;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function ensureOffscreenPort() {
  await ensureOffscreenDocument();

  if (offscreenPort && offscreenReady) return;

  if (!offscreenReadyPromise) {
    offscreenReadyPromise = new Promise((resolve, reject) => {
      offscreenReadyResolve = resolve;
      offscreenReadyReject = reject;
    });

    offscreenReadyTimeoutId = setTimeout(() => {
      if (offscreenReadyReject) {
        offscreenReadyReject(new Error('Offscreen renderer did not become ready'));
      }
      offscreenReady = false;
      offscreenReadyPromise = null;
      offscreenReadyResolve = null;
      offscreenReadyReject = null;
      offscreenReadyTimeoutId = null;
    }, 15000);
  }

  if (offscreenPort && !offscreenReady) {
    try {
      offscreenPort.postMessage({ type: 'ping' });
    } catch (e) {
      console.warn('Failed to ping offscreen port:', e);
    }
  }

  await offscreenReadyPromise;
}

async function sendMessageToOffscreenPort(message) {
  await ensureOffscreenPort();

  if (!offscreenPort) {
    throw new Error('Offscreen renderer port not available');
  }

  const requestId = `offscreen-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const images = [];

  let timeoutId = null;
  const responsePromise = new Promise((resolve, reject) => {
    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        pendingOffscreenRequests.delete(requestId);
        reject(new Error('Offscreen renderer timeout after 120s'));
      }, 120000);
    };

    pendingOffscreenRequests.set(requestId, {
      resolve,
      reject,
      images,
      inflight: 0,
      done: false,
      resetTimeout
    });

    resetTimeout();
  });

  offscreenPort.postMessage({
    ...message,
    requestId
  });

  try {
    return await responsePromise;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request?.action, 'from', sender?.id || sender?.tab?.id || 'unknown');
  if (request.action === 'askQuestion') {
    handleQuestionRequest(request)
      .then((response) => sendResponse(response))
      .catch((error) => {
        console.error('Error in askQuestion handler:', error);
        sendResponse({
          success: false,
          error: error.message || 'An unknown error occurred'
        });
      });
  }
  return true; // Keep channel open for async response
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'askQuestion') {
    return;
  }

  port.onMessage.addListener((request) => {
    handleQuestionRequest(request)
      .then((response) => port.postMessage(response))
      .catch((error) => {
        console.error('Error in askQuestion handler (port):', error);
        port.postMessage({
          success: false,
          error: error.message || 'An unknown error occurred'
        });
      });
  });
});

async function handleQuestionRequest(request) {
  const {
    question,
    files,
    apiKey,
    driveAccessToken = null,
    proxyUrl,
    vectorApiUrl = null,
    vectorApiKey = null,
    useLocalLLM = false,
    localModelName = 'llama3.2:3b-instruct',
    hfModel = 'google/gemma-2-2b-it'
  } = request;
  
  try {
    console.log('handleQuestionRequest start', {
      questionLength: question?.length || 0,
      fileCount: files?.length || 0,
      useLocalLLM,
      hfModel
    });
    // Validate inputs
    if (!question) {
      throw new Error('Question is required');
    }
    if (!useLocalLLM && !apiKey) {
      throw new Error('Provide a Hugging Face API key or enable Local Ollama.');
    }
    
    if (!files || files.length === 0) {
      throw new Error('No files available. Please upload files first.');
    }
    
    // Extract text from files
    const extractionResult = await extractTextFromFiles(files, driveAccessToken);
    
    if (extractionResult.documents.length === 0) {
      throw new Error('Could not extract text from files. Try uploading .txt or text-based PDFs.');
    }
    
    console.log(`Successfully extracted text from ${extractionResult.documents.length} file(s)`);
    
    if (!driveAccessToken) {
      throw new Error('Google Drive authorization required to load vector store.');
    }

    console.log('Building RAG context...');
    let ragContext;
    try {
      if (vectorApiUrl) {
        ragContext = await buildRagContextWithServer(
          question,
          extractionResult.documents,
          apiKey,
          vectorApiUrl,
          vectorApiKey
        );
      } else {
        ragContext = await buildRagContext(
          question,
          extractionResult.documents,
          apiKey,
          driveAccessToken
        );
      }
    } catch (ragError) {
      console.warn('RAG indexing failed, falling back to full text:', ragError);
      ragContext = extractionResult.documents
        .map(doc => `[Document: ${doc.fileName}]\n${doc.text}`)
        .join('\n\n---\n\n');
    }
    console.log('RAG context built, length:', ragContext.length);
    
    console.log('Calling LLM...');
    // Call LLM with local preference and fallback options
    const answer = await callLlamaLLMWithRetry(
      question,
      ragContext,
      apiKey,
      3,
      proxyUrl,
      useLocalLLM,
      localModelName,
      hfModel
    );
    
    console.log('LLM call completed');
    console.log('handleQuestionRequest success, answer length:', answer?.length || 0);
    return {
      success: true,
      answer: answer
    };
  } catch (error) {
    console.error('Error in askQuestion:', error);
    return {
      success: false,
      error: error.message || 'An unknown error occurred'
    };
  }
}

async function extractTextFromFiles(files, driveAccessToken) {
  const documents = [];
  
  console.log(`=== extractTextFromFiles called with ${files.length} files ===`);
  
  for (const file of files.slice(0, 10)) { // Limit to first 10 files
    try {
      let result;
      
      console.log(`Processing file: ${file.name}, type: ${file.type}, url: ${file.url}`);
      
      // Check if it's a manually uploaded file with content
      if (file.driveFileId) {
        if (!driveAccessToken) {
          throw new Error('Google Drive authorization required to read uploaded files.');
        }
        console.log('  → Drive file detected, downloading from Drive');
        const blob = await downloadDriveFileBlob(file.driveFileId, driveAccessToken);
        result = await extractTextFromBlob(blob, file.type, file.name);
      } else if (file.content && file.url && file.url.startsWith('local-file://')) {
        console.log('  → Has content and local-file URL, calling extractFromDataURL');
        result = await extractFromDataURL(file.content, file.type, file.name);
      } else {
        console.log(`  → No content or not local-file, calling fetchFileContent`);
        result = await fetchFileContent(file.url);
      }
      
      console.log(`Extracted result type: ${typeof result}`);
      
      if (result) {
        if (typeof result === 'string' && result.length > 0) {
          // Skip placeholder messages
          if (result.includes('Add pdf.js library') || result.includes('Add mammoth.js library')) {
            console.warn(`Skipping ${file.name}: requires library for extraction`);
            continue;
          }
          console.log(`Adding text content from ${file.name}: ${result.substring(0, 50)}...`);
          documents.push({
            fileName: file.name,
            fileUrl: file.url,
            text: result
          });
        }
      }
    } catch (error) {
      console.error(`Error extracting from ${file.name}:`, error);
    }
  }
  
  console.log(`=== extractTextFromFiles done: ${documents.length} document(s) ===`);
  return { documents };
}

async function extractFromDataURL(dataUrl, fileType, fileName) {
  try {
    console.log(`extractFromDataURL called: fileName=${fileName}, fileType=${fileType}`);
    
    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    return await extractTextFromBlob(blob, fileType, fileName, dataUrl);
  } catch (error) {
    console.error('Error extracting from data URL:', error);
    return null;
  }
}

async function extractTextFromBlob(blob, fileType, fileName, dataUrl = null) {
  console.log(`File: ${fileName}, MIME: ${blob.type}, Size: ${blob.size} bytes`);

  const lowerName = fileName.toLowerCase();
  const mimeType = blob.type || '';

  if (fileType === 'text' || lowerName.endsWith('.txt') || mimeType.includes('text/plain')) {
    console.log('Detected as text file');
    const text = await blob.text();
    console.log(`Extracted ${text.length} chars from text file`);
    return text;
  }

  if (fileType === 'pdf' || lowerName.endsWith('.pdf') || mimeType.includes('pdf')) {
    console.log('✓ PDF detected - extracting text');
    try {
      if (dataUrl) {
        const text = await sendMessageToOffscreen({
          action: 'extractPDFText',
          pdfDataUrl: dataUrl,
          fileName: fileName
        });
        if (text && text.length > 50) {
          console.log(`✓ Successfully extracted ${text.length} chars from PDF`);
          return text;
        }
      }

      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const arrayData = Array.from(bytes);
      const text = await sendMessageToOffscreen({
        action: 'extractPDFText',
        arrayBuffer: arrayData,
        fileName: fileName
      });
      if (text && text.length > 50) {
        console.log(`✓ Successfully extracted ${text.length} chars from PDF`);
        return text;
      }

      console.warn('PDF extraction returned empty or short text');
      return '[PDF appears empty or unreadable. Try a text-based PDF or convert to .txt]';
    } catch (e) {
      console.error('PDF text extraction failed:', e);
      return `[Error extracting PDF: ${e.message}. Try converting to .txt format.]`;
    }
  }

  if (fileType === 'document' || lowerName.endsWith('.docx') || lowerName.endsWith('.doc') || mimeType.includes('word')) {
    console.warn('Word document detected - attempting text extraction');
    return `[Unable to extract text from Word document: ${fileName}. Please save as .txt or PDF instead.]`;
  }

  try {
    const text = await blob.text();
    if (text && text.length > 0) {
      console.log(`Extracted ${text.length} chars from unknown file type`);
      return text;
    }
  } catch (e) {
    console.error('Generic text extraction failed:', e);
  }

  return null;
}

async function downloadDriveFileBlob(fileId, token) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Drive download failed (${response.status}): ${errorText || response.statusText}`);
  }

  return await response.blob();
}

async function extractPDFText(arrayBuffer) {
  if (!pdfjsLib) {
    throw new Error('PDF.js not loaded');
  }
  
  try {
    console.log('Attempting PDF text extraction (service worker context)');
    
    const loadingTask = pdfjsLib.getDocument({ 
      data: arrayBuffer,
      disableWorker: true,
      useWorkerFetch: false,
      useRangeRequests: false
    });
    
    const pdf = await loadingTask.promise;
    console.log(`PDF loaded: ${pdf.numPages} pages`);
    
    let fullText = '';
    const maxPages = Math.min(pdf.numPages, 20); // Limit to 20 pages
    
    // Extract text from each page
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map(item => item.str)
          .join(' ');
        
        console.log(`Page ${pageNum}: extracted ${pageText.length} chars - sample: "${pageText.substring(0, 100)}..."`);
        
        fullText += `\n\n--- Page ${pageNum} ---\n${pageText}`;
      } catch (pageError) {
        console.warn(`Error extracting page ${pageNum}:`, pageError);
      }
    }
    
    console.log(`✓ Extracted ${fullText.length} total characters from PDF`);
    console.log(`SAMPLE OF EXTRACTED TEXT (first 200 chars):\n"${fullText.substring(0, 200)}"`);
    
    // Return as text, not images (workaround for service worker limitation)
    return fullText.trim();
  } catch (error) {
    console.error('PDF text extraction failed:', error);
    throw error;
  }
}

async function fetchFileContent(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include' // Include cookies for Brightspace authentication
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const contentType = response.headers.get('content-type');
    
  if (contentType && contentType.includes('text')) {
    return await response.text();
  } else if (contentType && contentType.includes('pdf')) {
    const arrayBuffer = await response.arrayBuffer();
    const arrayData = Array.from(new Uint8Array(arrayBuffer));
    const text = await sendMessageToOffscreen({
      action: 'extractPDFText',
      arrayBuffer: arrayData
    });
    return text;
  } else if (contentType && contentType.includes('word')) {
    return 'Word document detected. Add mammoth.js library to extract full text.';
  } else {
      return await response.text();
    }
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    return null;
  }
}

function createPrompt(question, context) {
  return `You are a helpful academic assistant answering questions about course materials based on the provided excerpts from course documents.

COURSE EXCERPTS:
${context}

QUESTION: ${question}

Please provide a clear, accurate, and concise answer based ONLY on the course materials provided above. If the information is not in the materials, say "This information is not available in the provided course materials."

ANSWER:`;
}

function trimContextToTokenLimit(context, maxTokens = 12000) {
  // Rough estimate: 1 token ≈ 4 characters
  const maxCharacters = maxTokens * 4;
  
  if (context.length <= maxCharacters) {
    return context;
  }
  
  // Keep beginning and end
  const half = maxCharacters / 2;
  return context.substring(0, half) + '\n... (content trimmed) ...\n' + 
         context.substring(context.length - half);
}

const VECTOR_STORE_VERSION = 3;
const EMBEDDING_MODEL = 'Qwen/Qwen3-Embedding-8B';
const RAG_TOP_K = 8;
const RAG_CHUNK_SIZE = 1200;
const RAG_CHUNK_OVERLAP = 150;
const RAG_MAX_CHUNKS_PER_DOC = 80;

async function buildRagContext(question, documents, apiKey, driveAccessToken) {
  console.log('Loading vector store from Drive...');
  const store = await loadVectorStore(driveAccessToken);
  console.log('Vector store loaded. Files:', Object.keys(store.files || {}).length);
  const fileIdMap = new Map();
  const updatedStore = { ...store, files: { ...(store.files || {}) } };

  for (const doc of documents) {
    const fileId = buildFileId(doc);
    fileIdMap.set(fileId, doc);
    const contentHash = hashText(doc.text || '');
    const existing = updatedStore.files[fileId];
    if (existing && existing.contentHash === contentHash) {
      continue;
    }

    console.log('Chunking document:', doc.fileName);
    const chunks = chunkTextForEmbeddings(doc.text || '');
    const limitedChunks = chunks.slice(0, RAG_MAX_CHUNKS_PER_DOC);
    console.log('Embedding chunks:', limitedChunks.length);
    const embeddings = await embedTexts(limitedChunks, apiKey);
    const chunkEntries = limitedChunks.map((text, index) => ({
      id: `${fileId}::${index}`,
      text,
      embedding: normalizeEmbedding(embeddings[index] || [])
    }));

    updatedStore.files[fileId] = {
      fileName: doc.fileName,
      fileUrl: doc.fileUrl || '',
      contentHash,
      updatedAt: new Date().toISOString(),
      chunks: chunkEntries
    };
  }

  console.log('Saving vector store to Drive...');
  await saveVectorStore(updatedStore, driveAccessToken);
  console.log('Vector store saved.');

  console.log('Embedding query...');
  const queryEmbedding = normalizeEmbedding(
    (await embedTexts([question], apiKey))[0] || []
  );
  console.log('Query embedding ready.');
  const scored = [];

  for (const [fileId, doc] of fileIdMap.entries()) {
    const entry = updatedStore.files[fileId];
    if (!entry || !entry.chunks) continue;
    for (const chunk of entry.chunks) {
      scored.push({
        fileName: entry.fileName || doc.fileName,
        text: chunk.text,
        score: cosineSimilarity(queryEmbedding, chunk.embedding || [])
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const topChunks = scored.slice(0, RAG_TOP_K);
  if (topChunks.length === 0) {
    return documents.map(doc => `[Document: ${doc.fileName}]\n${doc.text}`).join('\n\n---\n\n');
  }

  return topChunks.map((chunk, index) => {
    return `[Excerpt ${index + 1}] (Source: ${chunk.fileName})\n${chunk.text}`;
  }).join('\n\n');
}

async function buildRagContextWithServer(question, documents, apiKey, vectorApiUrl, vectorApiKey) {
  const fileIdMap = new Map();
  const upsertPayload = [];

  for (const doc of documents) {
    const fileId = buildFileId(doc);
    fileIdMap.set(fileId, doc);
    const chunks = chunkTextForEmbeddings(doc.text || '');
    const limitedChunks = chunks.slice(0, RAG_MAX_CHUNKS_PER_DOC);
    console.log('Embedding chunks for server:', limitedChunks.length);
    const embeddings = await embedTexts(limitedChunks, apiKey);
    limitedChunks.forEach((text, index) => {
      upsertPayload.push({
        fileId,
        fileName: doc.fileName,
        chunkId: `${fileId}::${index}`,
        text,
        embedding: normalizeEmbedding(embeddings[index] || [])
      });
    });
  }

  if (upsertPayload.length > 0) {
    console.log('Upserting vectors to server:', upsertPayload.length);
    await upsertVectorsToServer(vectorApiUrl, vectorApiKey, upsertPayload);
  }

  console.log('Embedding query for server...');
  const queryEmbedding = normalizeEmbedding(
    (await embedTexts([question], apiKey))[0] || []
  );

  const topChunks = await queryVectorsFromServer(vectorApiUrl, vectorApiKey, queryEmbedding, RAG_TOP_K);
  if (!topChunks || topChunks.length === 0) {
    return documents.map(doc => `[Document: ${doc.fileName}]\n${doc.text}`).join('\n\n---\n\n');
  }

  return topChunks.map((chunk, index) => {
    return `[Excerpt ${index + 1}] (Source: ${chunk.fileName})\n${chunk.text}`;
  }).join('\n\n');
}

function buildVectorApiUrl(baseUrl, path) {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}${path}`;
}

async function upsertVectorsToServer(baseUrl, apiKey, documents) {
  const url = buildVectorApiUrl(baseUrl, '/vectors/upsert');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {})
    },
    body: JSON.stringify({ documents })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Vector upsert failed (${response.status}): ${errorText || response.statusText}`);
  }
}

async function queryVectorsFromServer(baseUrl, apiKey, embedding, topK) {
  const url = buildVectorApiUrl(baseUrl, '/vectors/query');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'x-api-key': apiKey } : {})
    },
    body: JSON.stringify({ embedding, topK })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Vector query failed (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  return data?.results || [];
}

function chunkTextForEmbeddings(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const chunks = [];
  for (let i = 0; i < cleaned.length; i += (RAG_CHUNK_SIZE - RAG_CHUNK_OVERLAP)) {
    chunks.push(cleaned.substring(i, i + RAG_CHUNK_SIZE));
  }
  return chunks;
}

async function embedTexts(texts, apiKey) {
  if (!texts || texts.length === 0) return [];
  if (!apiKey) {
    throw new Error('Hugging Face API key required for embeddings.');
  }
  return callHuggingFaceEmbeddings(texts, apiKey);
}

async function callHuggingFaceEmbeddings(texts, apiKey) {
  const endpoint = 'https://router.huggingface.co/nebius/v1/embeddings';
  console.log('Embedding request to', endpoint, 'count:', texts.length);
  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    method: 'POST',
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Embedding API error (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  console.log('Embedding response received.');
  return parseNebiusEmbeddingResponse(data, texts.length);
}

function parseNebiusEmbeddingResponse(data, expectedCount) {
  if (!data || !Array.isArray(data.data)) {
    return Array.from({ length: expectedCount }, () => []);
  }

  const embeddings = data.data.map(item => item.embedding || []);
  if (expectedCount === 1 && embeddings.length > 0) {
    return [embeddings[0]];
  }
  return embeddings;
}

function parseEmbeddingResponse(data, expectedCount) {
  if (!Array.isArray(data)) {
    return Array.from({ length: expectedCount }, () => []);
  }

  if (expectedCount === 1 || data.length !== expectedCount) {
    return [coerceEmbedding(data)];
  }

  return data.map(item => coerceEmbedding(item));
}

function coerceEmbedding(item) {
  if (!Array.isArray(item) || item.length === 0) return [];
  if (typeof item[0] === 'number') {
    return item;
  }
  if (Array.isArray(item[0])) {
    return meanPoolEmbedding(item);
  }
  return [];
}

function meanPoolEmbedding(matrix) {
  const rows = matrix.length;
  if (rows === 0) return [];
  const dim = matrix[0].length || 0;
  if (dim === 0) return [];
  const sums = new Array(dim).fill(0);
  for (const row of matrix) {
    for (let i = 0; i < dim; i++) {
      sums[i] += row[i] || 0;
    }
  }
  return sums.map(value => value / rows);
}

function normalizeEmbedding(vector) {
  if (!Array.isArray(vector) || vector.length === 0) return [];
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (!norm) return vector;
  return vector.map(v => v / norm);
}

function cosineSimilarity(a, b) {
  if (!a.length || !b.length || a.length !== b.length) return -1;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

function buildFileId(doc) {
  if (doc.fileUrl) return `url:${doc.fileUrl}`;
  return `name:${doc.fileName || 'unknown'}`;
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return `${hash}`;
}

async function loadVectorStore(driveAccessToken) {
  if (!driveAccessToken) {
    return { version: VECTOR_STORE_VERSION, files: {} };
  }

  try {
    const fileId = await ensureVectorStoreFileId(driveAccessToken);
    if (!fileId) {
      return { version: VECTOR_STORE_VERSION, files: {} };
    }
    const content = await downloadDriveFileText(fileId, driveAccessToken);
    if (!content) {
      return { version: VECTOR_STORE_VERSION, files: {} };
    }
    const parsed = JSON.parse(content);
    const store = await unwrapVectorStore(parsed);
    if (!store || store.version !== VECTOR_STORE_VERSION) {
      return { version: VECTOR_STORE_VERSION, files: {} };
    }
    return expandVectorStore(store);
  } catch (error) {
    console.warn('Failed to load vector store from Drive:', error);
    return { version: VECTOR_STORE_VERSION, files: {} };
  }
}

async function saveVectorStore(store, driveAccessToken) {
  if (!driveAccessToken) {
    return;
  }

  const fileId = await ensureVectorStoreFileId(driveAccessToken);
  if (!fileId) return;

  const payload = await wrapVectorStore(compactVectorStore(store));
  await uploadDriveJsonFile(fileId, payload, driveAccessToken);
}

async function wrapVectorStore(store) {
  const json = JSON.stringify(store);
  if (typeof CompressionStream === 'undefined') {
    return { version: store.version, compressed: false, data: store };
  }

  const compressed = await gzipString(json);
  return {
    version: store.version,
    compressed: true,
    data: bytesToBase64(compressed),
    updatedAt: new Date().toISOString()
  };
}

async function unwrapVectorStore(payload) {
  if (!payload) return null;
  if (payload.files && payload.version) {
    return payload;
  }
  if (payload.compressed && payload.data) {
    const bytes = base64ToBytes(payload.data);
    if (typeof DecompressionStream === 'undefined') {
      return null;
    }
    const json = await gunzipString(bytes);
    return JSON.parse(json);
  }
  if (payload.data && payload.data.files) {
    return payload.data;
  }
  return null;
}

function compactVectorStore(store) {
  if (!store || !store.files) return store;
  const files = {};
  for (const [fileId, file] of Object.entries(store.files)) {
    const chunks = (file.chunks || []).map(chunk => {
      const embedding = Array.isArray(chunk.embedding) || ArrayBuffer.isView(chunk.embedding)
        ? compactEmbedding(chunk.embedding)
        : chunk.embedding;
      return {
        ...chunk,
        embedding
      };
    });
    files[fileId] = { ...file, chunks };
  }
  return { ...store, files };
}

function expandVectorStore(store) {
  if (!store || !store.files) return store;
  const files = {};
  for (const [fileId, file] of Object.entries(store.files)) {
    const chunks = (file.chunks || []).map(chunk => {
      const embedding = expandEmbedding(chunk.embedding);
      return {
        ...chunk,
        embedding
      };
    });
    files[fileId] = { ...file, chunks };
  }
  return { ...store, files };
}

function compactEmbedding(embedding) {
  if (!embedding || (Array.isArray(embedding) && embedding.length === 0)) {
    return embedding;
  }
  const array = ArrayBuffer.isView(embedding)
    ? new Float32Array(embedding)
    : Float32Array.from(embedding);
  const bytes = new Uint8Array(array.buffer);
  return {
    format: 'f32b64',
    length: array.length,
    data: bytesToBase64(bytes)
  };
}

function expandEmbedding(embedding) {
  if (!embedding) return embedding;
  if (embedding.format === 'f32b64' && typeof embedding.data === 'string') {
    const bytes = base64ToBytes(embedding.data);
    if (bytes.byteLength % 4 !== 0) {
      return [];
    }
    const floatArray = new Float32Array(bytes.buffer);
    return floatArray;
  }
  return embedding;
}

async function gzipString(text) {
  const encoder = new TextEncoder();
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(encoder.encode(text));
  await writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new Uint8Array(buffer);
}

async function gunzipString(bytes) {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  const buffer = await new Response(stream.readable).arrayBuffer();
  return new TextDecoder().decode(buffer);
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const DRIVE_VECTOR_FOLDER = 'Brightspace LLM Assistant';
const DRIVE_VECTOR_FILE = 'vector-store.json';

async function ensureVectorStoreFileId(token) {
  const folderId = await ensureDriveFolderId(token);
  if (!folderId) return null;

  const query = `name='${DRIVE_VECTOR_FILE}' and '${folderId}' in parents and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`;
  const searchResp = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (searchResp.ok) {
    const searchData = await searchResp.json();
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }
  }

  const metadata = {
    name: DRIVE_VECTOR_FILE,
    mimeType: 'application/json',
    parents: [folderId]
  };
  const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(metadata)
  });
  if (!createResp.ok) {
    return null;
  }
  const created = await createResp.json();
  return created.id || null;
}

async function ensureDriveFolderId(token) {
  const query = `name='${DRIVE_VECTOR_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`;
  const searchResp = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (searchResp.ok) {
    const searchData = await searchResp.json();
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }
  }

  const metadata = {
    name: DRIVE_VECTOR_FOLDER,
    mimeType: 'application/vnd.google-apps.folder'
  };
  const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(metadata)
  });
  if (!createResp.ok) {
    return null;
  }
  const created = await createResp.json();
  return created.id || null;
}

async function uploadDriveJsonFile(fileId, payload, token) {
  const boundary = '===============7330845974216740156==';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const content = JSON.stringify(payload);

  const metadata = {
    name: DRIVE_VECTOR_FILE,
    mimeType: 'application/json'
  };

  const multipartBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    content +
    closeDelimiter;

  const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary="${boundary}"`
    },
    body: multipartBody
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Vector store upload failed (${response.status}): ${errorText || response.statusText}`);
  }
}

async function downloadDriveFileText(fileId, token) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Vector store download failed (${response.status}): ${errorText || response.statusText}`);
  }
  return await response.text();
}

async function callLlamaLLMWithRetry(question, ragContext, apiKey, maxRetries = 3, proxyUrl = null, useLocalLLM = false, localModelName = 'llama3.2:3b-instruct', hfModel = 'google/gemma-2-2b-it') {
  let lastError;
  
  console.log(`\n=== BUILDING PROMPT ===`);
  console.log(`RAG context length: ${ragContext.length} characters`);
  console.log(`First 300 chars of context:\n"${ragContext.substring(0, 300)}"`);
  
  const trimmedText = trimContextToTokenLimit(ragContext, 6000);
  const prompt = createPrompt(question, trimmedText);

  console.log(`Final prompt length: ${prompt.length} characters`);
  console.log(`=== PROMPT BUILT ===\n`);
  
  // Text-only messages
  const messages = [
    { 
      role: 'system', 
      content: 'You are a helpful academic assistant. Answer questions based on the provided course excerpts.' 
    },
    { 
      role: 'user', 
      content: prompt
    }
  ];
  
  // Local mode: Ollama first
  if (useLocalLLM) {
    try {
      await ensureOllamaModel(localModelName);
      const localAnswer = await callOllama(localModelName, prompt);
      if (localAnswer) return localAnswer;
    } catch (e) {
      lastError = e;
      if (!apiKey) {
        throw new Error(
          `Local model failed: ${e.message}\n` +
          `Tips:\n- Install & run Ollama: brew install ollama && ollama serve\n- Pull model: ollama pull ${localModelName}`
        );
      }
      // else: fall through to Router using API key
    }
  }
  
  // Fall back to Hugging Face Router for text-only models
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt} to call Hugging Face Router with model: ${hfModel}...`);
      
      const endpoint = proxyUrl && proxyUrl.length > 0
        ? proxyUrl // e.g. http://localhost:3001/hf
        : 'https://router.huggingface.co/v1/chat/completions';
      
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
        body: JSON.stringify({
          model: hfModel,
          messages: messages,
          temperature: 0.7,
          top_p: 0.95,
          max_tokens: 1000
        })
      });
      
      if (response.status === 429) {
        console.log('Rate limited, waiting...');
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        continue;
      }
      
      if (!response.ok) {
        let rawBody = '';
        try {
          rawBody = await response.clone().text();
        } catch (e) {
          rawBody = '';
        }

        let errorMsg = response.statusText;
        try {
          const errorData = await response.json();
          errorMsg = errorData.error?.message || errorData.error || errorMsg;
        } catch (e) {
          if (rawBody) {
            errorMsg = rawBody;
          }
        }
        if (rawBody) {
          console.error('Router error body:', rawBody);
        }
        throw new Error(`API Error (${response.status}): ${errorMsg}`);
      }
      
      const result = await response.json();
      console.log('=== API RESPONSE ===');
      console.log(JSON.stringify(result, null, 2));
      console.log('===================');
      
      // Router returns OpenAI-compatible response
      if (result && Array.isArray(result.choices) && result.choices.length > 0) {
        const msg = result.choices[0].message;
        let answer = (msg && msg.content) ? msg.content.trim() : '';
        console.log(`Answer extracted: ${answer.substring(0, 200)}...`);
        return answer || 'Unable to generate a response.';
      }
      
      throw new Error('Unexpected Router API response format');
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt} failed:`, error);
      
      if (attempt < maxRetries) {
        await new Promise(resolve => 
          setTimeout(resolve, 1000 * Math.pow(2, attempt - 1))
        );
      }
    }
  }
  
  throw new Error(
    'Could not reach LLM. Solutions:\n' +
    '1. Install & run local Ollama: brew install ollama && ollama serve\n' +
    '2. Check your Hugging Face API key\n' +
    '3. Try a different Hugging Face model\n' +
    'Error: ' + (lastError?.message || 'Unknown error')
  );
}

async function callOllama(model, prompt) {
  const resp = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { temperature: 0.3, top_p: 0.9 }
    })
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Ollama error (${resp.status}): ${text || resp.statusText}`);
  }
  const result = await resp.json();
  return result?.response || null;
}

async function ensureOllamaModel(model) {
  // Check if model exists
  try {
    const show = await fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model })
    });
    if (show.ok) return;
  } catch (_) {}
  // Attempt to pull the model
  const pull = await fetch('http://localhost:11434/api/pull', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model, stream: false })
  });
  if (!pull.ok) {
    const text = await pull.text().catch(() => '');
    throw new Error(`Failed to pull model '${model}'. ${text || ''}`.trim());
  }
}
