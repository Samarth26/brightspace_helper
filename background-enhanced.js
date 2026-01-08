// Enhanced version of background.js with better error handling and model selection

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'askQuestion') {
    handleQuestionRequest(request, sendResponse);
  }
  return true;
});

async function handleQuestionRequest(request, sendResponse) {
  const { question, files, apiKey } = request;
  
  try {
    // Validate inputs
    if (!question || !apiKey) {
      throw new Error('Question and API key are required');
    }
    
    if (!files || files.length === 0) {
      throw new Error('No files available. Please scan a page first.');
    }
    
    // Extract text from files
    const fileTexts = await extractTextFromFiles(files);
    
    if (fileTexts.length === 0) {
      throw new Error('Could not extract text from files');
    }
    
    // Combine context
    const combinedContext = fileTexts.join('\n\n---\n\n');
    
    // Trim context if too long (respect token limits)
    const trimmedContext = trimContextToTokenLimit(combinedContext, 1500);
    
    // Create optimized prompt
    const prompt = createOptimizedPrompt(question, trimmedContext);
    
    // Detect question type for better context
    const queryType = detectQueryType(question);
    console.log('Detected query type:', queryType);
    
    // Call LLM with retry logic
    const answer = await callLlamaLLMWithRetry(prompt, apiKey, 3);
    
    sendResponse({
      success: true,
      answer: answer,
      queryType: queryType
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
  
  for (const file of files.slice(0, 10)) { // Limit to first 10 files
    try {
      let text = null;
      
      if (file.type === 'pdf') {
        // For PDFs, fetch but note that full extraction requires pdf.js
        text = await fetchFileContent(file.url);
      } else if (file.type === 'document' || file.type === 'text') {
        text = await fetchFileContent(file.url);
      } else {
        text = await fetchFileContent(file.url);
      }
      
      if (text && text.length > 0) {
        texts.push(`[Document: ${file.name}]\n${text.substring(0, 3000)}`);
      }
    } catch (error) {
      console.error(`Error extracting from ${file.name}:`, error);
      // Continue with next file
    }
  }
  
  return texts;
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
    
    // Try to get as text
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('text')) {
      return await response.text();
    } else if (contentType && contentType.includes('pdf')) {
      // For PDFs, return a note (full extraction needs pdf.js)
      return 'PDF file detected. Add pdf.js library to extract full text.';
    } else if (contentType && contentType.includes('word')) {
      // For Word docs, return a note (full extraction needs mammoth.js)
      return 'Word document detected. Add mammoth.js library to extract full text.';
    } else {
      // Try anyway
      return await response.text();
    }
  } catch (error) {
    console.error(`Error fetching ${url}:`, error);
    return null;
  }
}

function trimContextToTokenLimit(context, maxTokens = 1500) {
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

function detectQueryType(question) {
  const q = question.toLowerCase();
  
  if (q.includes('deadline') || q.includes('due') || q.includes('when')) {
    return 'deadline';
  } else if (q.includes('grade') || q.includes('score') || q.includes('point')) {
    return 'grading';
  } else if (q.includes('objective') || q.includes('goal') || q.includes('learn')) {
    return 'learning_objectives';
  } else if (q.includes('require') || q.includes('need') || q.includes('must')) {
    return 'requirements';
  } else if (q.includes('policy') || q.includes('rule') || q.includes('attend')) {
    return 'policy';
  }
  
  return 'general';
}

function createOptimizedPrompt(question, context) {
  return `You are a helpful academic assistant answering questions about course materials based on the provided syllabus and course documents.

COURSE MATERIALS:
${context}

QUESTION: ${question}

Please provide a clear, accurate, and concise answer based ONLY on the course materials provided above. If the information is not in the materials, say "This information is not available in the provided course materials."

ANSWER:`;
}

async function callLlamaLLMWithRetry(prompt, apiKey, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt} to call Llama LLM...`);
      
      // Try primary model first
      const response = await fetch(
        'https://api-inference.huggingface.co/models/meta-llama/Llama-2-7b-chat-hf',
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          method: 'POST',
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              max_new_tokens: 500,
              temperature: 0.7,
              top_p: 0.95,
              repetition_penalty: 1.2
            },
            options: {
              wait_for_model: true,
              use_cache: false
            }
          }),
        }
      );
      
      if (response.status === 429) {
        // Rate limited, wait and retry
        console.log('Rate limited, waiting before retry...');
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        continue;
      }
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          `API Error (${response.status}): ${error.error?.message || response.statusText}`
        );
      }
      
      const result = await response.json();
      
      if (Array.isArray(result) && result[0] && result[0].generated_text) {
        let answer = result[0].generated_text;
        
        // Clean up the response
        if (answer.includes('ANSWER:')) {
          answer = answer.split('ANSWER:')[1].trim();
        }
        
        // Remove prompt from response if it's there
        if (answer.includes(prompt)) {
          answer = answer.replace(prompt, '').trim();
        }
        
        return answer || 'Unable to generate a response.';
      }
      
      throw new Error('Unexpected API response format');
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt} failed:`, error);
      
      if (attempt < maxRetries) {
        // Wait before retry with exponential backoff
        await new Promise(resolve => 
          setTimeout(resolve, 1000 * Math.pow(2, attempt - 1))
        );
      }
    }
  }
  
  throw lastError || new Error('Failed to get response after multiple attempts');
}

// Optional: Fallback to free inference endpoints
async function callPublicLLMAPI(prompt) {
  try {
    // Using together.ai free API (example - requires signup)
    const response = await fetch('https://api.together.xyz/inference', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'togethercomputer/llama-2-7b-chat',
        prompt: prompt,
        max_tokens: 500,
        temperature: 0.7,
        top_p: 0.95,
        top_k: 40,
      })
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result.output?.choices[0]?.text || 'No response generated';
  } catch (error) {
    console.error('Error calling public API:', error);
    throw error;
  }
}
