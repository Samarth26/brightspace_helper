// Background service worker for Brightspace LLM Assistant
// Enhanced version with retry logic and better error handling

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
      chrome.runtime.sendMessage(message, (response) => {
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'askQuestion') {
    handleQuestionRequest(request, sendResponse);
  }
  return true; // Keep channel open for async response
});

async function handleQuestionRequest(request, sendResponse) {
  const { question, files, apiKey, proxyUrl, useLocalLLM = false, localModelName = 'llama3.2:3b-instruct', hfModel = 'meta-llama/Llama-3.3-70B-Instruct' } = request;
  
  try {
    // Validate inputs
    if (!question) {
      throw new Error('Question is required');
    }
    if (!useLocalLLM && !apiKey) {
      throw new Error('Provide a Hugging Face API key or enable Local Ollama.');
    }
    
    if (!files || files.length === 0) {
      throw new Error('No files available. Please scan a page first.');
    }
    
    // Extract text from files
    const extractionResult = await extractTextFromFiles(files);
    
    if (extractionResult.texts.length === 0 && extractionResult.images.length === 0) {
      throw new Error('Could not extract content from files. Try uploading .txt files or plain text documents.');
    }
    
    console.log(`Successfully extracted ${extractionResult.texts.length} text files and ${extractionResult.images.length} PDF images`);
    
    // Call LLM with local preference and fallback options
    const answer = await callLlamaLLMWithRetry(question, extractionResult, apiKey, 3, proxyUrl, useLocalLLM, localModelName, hfModel);
    
    sendResponse({
      success: true,
      answer: answer
    });
  } catch (error) {
    console.error('Error in askQuestion:', error);
    sendResponse({
      success: false,
      error: error.message || 'An unknown error occurred'
    });
  }
}

async function extractTextFromFiles(files) {
  const texts = [];
  const images = [];
  
  console.log(`=== extractTextFromFiles called with ${files.length} files ===`);
  
  for (const file of files.slice(0, 10)) { // Limit to first 10 files
    try {
      let result;
      
      console.log(`Processing file: ${file.name}, type: ${file.type}, url: ${file.url}`);
      
      // Check if it's a manually uploaded file with content
      if (file.content && file.url.startsWith('local-file://')) {
        console.log(`  → Has content and local-file URL, calling extractFromDataURL`);
        result = await extractFromDataURL(file.content, file.type, file.name);
      } else {
        console.log(`  → No content or not local-file, calling fetchFileContent`);
        result = await fetchFileContent(file.url);
      }
      
      console.log(`Extracted result type: ${typeof result}, is object with images: ${typeof result === 'object' && result && result.type === 'images'}`);
      
      if (result) {
        // Check if it's image data (from PDF)
        if (typeof result === 'object' && result.type === 'images') {
          console.log(`✓ Adding ${result.data.length} PDF page images from ${file.name}`);
          images.push(...result.data.map(img => ({
            ...img,
            fileName: file.name
          })));
        } else if (typeof result === 'string' && result.length > 0) {
          // Skip placeholder messages
          if (result.includes('Add pdf.js library') || result.includes('Add mammoth.js library')) {
            console.warn(`Skipping ${file.name}: requires library for extraction`);
            continue;
          }
          console.log(`Adding text content from ${file.name}: ${result.substring(0, 50)}...`);
          texts.push(`[Document: ${file.name}]\n${result.substring(0, 5000)}`);
        }
      }
    } catch (error) {
      console.error(`Error extracting from ${file.name}:`, error);
    }
  }
  
  console.log(`=== extractTextFromFiles done: ${texts.length} texts, ${images.length} images ===`);
  return { texts, images };
}

async function extractFromDataURL(dataUrl, fileType, fileName) {
  try {
    console.log(`extractFromDataURL called: fileName=${fileName}, fileType=${fileType}`);
    
    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    console.log(`File: ${fileName}, MIME: ${blob.type}, Size: ${blob.size} bytes`);
    
    // For plain text files
    if (fileType === 'text' || fileName.endsWith('.txt') || blob.type.includes('text/plain')) {
      console.log('Detected as text file');
      const text = await blob.text();
      console.log(`Extracted ${text.length} chars from text file`);
      return text;
    }
    
    // For PDF files - delegate to offscreen document for rendering (offscreen has DOM access)
    if (fileType === 'pdf' || fileName.endsWith('.pdf') || blob.type.includes('pdf')) {
      console.log('✓ PDF detected - delegating to offscreen document for rendering via canvas');
      
      try {
        // Request offscreen document to convert PDF to images
        const images = await sendMessageToOffscreen({
          action: 'convertPDFToImages',
          pdfDataUrl: dataUrl,
          fileName: fileName
        });
        
        if (images && images.length > 0) {
          console.log(`✓ Offscreen document converted PDF to ${images.length} page images`);
          return {
            type: 'images',
            data: images
          };
        }
      } catch (e) {
        console.warn('Offscreen PDF rendering failed:', e);
      }
      
      // Fallback to text extraction
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const text = await extractPDFText(arrayBuffer);
        if (text && text.length > 50) {
          console.log(`✓ Fallback: Successfully extracted ${text.length} chars from PDF`);
          return text;
        } else {
          console.warn('PDF extraction returned empty or short text');
          return `[PDF appears empty or unreadable. Try a text-based PDF or convert to .txt]`;
        }
      } catch (e) {
        console.error('PDF text extraction fallback failed:', e);
        return `[Error extracting PDF: ${e.message}. Try converting to .txt format.]`;
      }
    }
    
    console.log('No specific handler matched, checking if it looks like PDF...');
    
    // Fallback: check if it might be a PDF by checking first bytes
    if (fileName.toLowerCase().endsWith('.pdf')) {
      console.log('File ends in .pdf but type not recognized, attempting PDF extraction anyway');
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const result = await extractPDFText(arrayBuffer);
        if (result && result.type === 'images') {
          console.log(`✓ Successfully converted PDF to ${result.data.length} images (via fallback)`);
          return result;
        }
      } catch (e) {
        console.error('PDF fallback extraction failed:', e);
      }
    }
    
    // For document files
    if (fileType === 'document' || fileName.endsWith('.docx') || fileName.endsWith('.doc') || blob.type.includes('word')) {
      console.warn('Word document detected - attempting text extraction');
      return `[Unable to extract text from Word document: ${fileName}. Please save as .txt or PDF instead.]`;
    }
    
    // Try as text for unknown types
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
  } catch (error) {
    console.error('Error extracting from data URL:', error);
    return null;
  }
}

async function extractPDFText(arrayBuffer) {
  if (!pdfjsLib) {
    throw new Error('PDF.js not loaded');
  }
  
  try {
    console.log('Attempting PDF text extraction (image conversion not available in service worker)');
    
    const loadingTask = pdfjsLib.getDocument({ 
      data: arrayBuffer,
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
      return 'PDF file detected. Add pdf.js library to extract full text.';
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
  return `You are a helpful academic assistant answering questions about course materials based on the provided syllabus and course documents.

COURSE MATERIALS:
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

async function callLlamaLLMWithRetry(question, extractionResult, apiKey, maxRetries = 3, proxyUrl = null, useLocalLLM = false, localModelName = 'llama3.2:3b-instruct', hfModel = 'meta-llama/Llama-3.3-70B-Instruct') {
  let lastError;
  
  // Combine all text content
  const allText = extractionResult.texts.join('\n\n---\n\n');
  console.log(`\n=== BUILDING PROMPT ===`);
  console.log(`Total extracted text: ${allText.length} characters`);
  console.log(`PDF images available: ${(extractionResult.images || []).length}`);
  console.log(`First 300 chars of text:\n"${allText.substring(0, 300)}"`);
  
  const trimmedText = trimContextToTokenLimit(allText, 12000);
  console.log(`After trimming to 12000 tokens: ${trimmedText.length} characters`);
  console.log(`First 300 chars of trimmed text:\n"${trimmedText.substring(0, 300)}"`);
  
  const prompt = `You are a helpful academic assistant answering questions about course materials based on the provided syllabus and course documents.

COURSE MATERIALS:
${trimmedText}

QUESTION: ${question}

Please provide a clear, accurate, and concise answer based ONLY on the course materials provided above. If the information is not in the materials, say "This information is not available in the provided course materials."

ANSWER:`;

  console.log(`Final prompt length: ${prompt.length} characters`);
  console.log(`=== PROMPT BUILT ===\n`);
  
  // Build messages for API - support both text and vision models
  let messages;
  
  // If we have PDF images, build a vision model message
  if (extractionResult.images && extractionResult.images.length > 0) {
    console.log(`\n=== BUILDING VISION MODEL MESSAGE WITH ${extractionResult.images.length} IMAGES ===`);
    
    // For vision models, include images in content
    messages = [
      { 
        role: 'system', 
        content: 'You are a helpful academic assistant. Answer questions based on the provided course materials and images.' 
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: prompt
          },
          // Add images from PDF pages
          ...extractionResult.images.map(img => ({
            type: 'image_url',
            image_url: {
              url: img.dataUrl,
              detail: 'high'
            }
          }))
        ]
      }
    ];
    console.log(`Added ${extractionResult.images.length} image(s) to vision model message`);
    console.log(`=== VISION MESSAGE BUILT ===\n`);
  } else {
    // Regular text-only messages
    messages = [
      { 
        role: 'system', 
        content: 'You are a helpful academic assistant. Answer questions based on the provided course materials.' 
      },
      { 
        role: 'user', 
        content: prompt
      }
    ];
  }
  
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
  
  // Fall back to Hugging Face Router with vision support
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
        let errorMsg = response.statusText;
        try {
          const errorData = await response.json();
          errorMsg = errorData.error?.message || errorData.error || errorMsg;
        } catch (e) {
          errorMsg = await response.text().catch(() => response.statusText);
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
