# Debugging Guide - Brightspace LLM Assistant

## How to Debug the Extension

### 1. Open the Extension's Developer Tools

**For Popup:**
1. Click extension icon → right-click → "Inspect"
2. DevTools opens showing popup code

**For Background Service Worker:**
1. Go to `chrome://extensions/`
2. Find "Brightspace LLM Assistant"
3. Click "Service worker" under the extension name
4. DevTools opens for background.js

**For Content Script:**
1. Go to a Brightspace page
2. Press F12 to open DevTools
3. Look for messages from "Brightspace LLM Assistant: Content script loaded"

### 2. Console Logging

All scripts log to the console. Check for these messages:

**Content Script (content.js):**
```
✓ Brightspace LLM Assistant: Content script loaded
✓ Found X files on this page
✓ Document: [filename]
```

**Background Service Worker (background.js):**
```
✓ Attempt 1 to call Llama LLM...
✓ API response received
✗ Error messages if something fails
```

**Popup (popup.js):**
```
✓ Loading scanned files...
✓ API key loaded
✗ Error: [error message]
```

### 3. Common Issues & Solutions

#### Issue: "Content script not loading"

**Symptoms:**
- "Unable to scan this page" error
- No console message about script loading

**Solutions:**
```javascript
// Check if running on correct domain
chrome://extensions/ → Find extension → Details
Make sure host_permissions includes your Brightspace URL

// Check manifest.json matches
The content_scripts section should match:
"matches": ["*://*.brightspace.com/*", "*://*.d2l.com/*"]
```

#### Issue: API Key Not Saving

**Symptoms:**
- API key disappears after refresh
- "API key saved" message doesn't appear

**Solutions:**
```javascript
// Check chrome.storage access
// In popup.js, verify:
chrome.storage.local.set({ hfApiKey: apiKey })
chrome.storage.local.get(['hfApiKey'], callback)

// Clear and retry:
1. Right-click extension → Remove
2. Go to chrome://extensions/
3. Delete the folder from your computer
4. Re-add the extension
5. Try saving API key again
```

#### Issue: Files Not Found

**Symptoms:**
- "No files scanned yet" message persists
- Click scan but nothing happens

**Solutions:**
```javascript
// Debug content.js file detection
// In browser console on Brightspace page:
document.querySelectorAll('a[href*=".pdf"]').length
document.querySelectorAll('a.d2l-link').length
document.querySelectorAll('.d2l-fileviewer').length

// Add this to content.js temporarily for debugging:
console.log('All links on page:', document.querySelectorAll('a'));
console.log('PDF links:', document.querySelectorAll('a[href*=".pdf"]'));

// Common reasons files aren't found:
1. Page is using lazy loading (wait 5-10 seconds)
2. Files in iframe elements (not currently scanned)
3. Different Brightspace theme uses different selectors
4. Files behind authentication walls
```

#### Issue: API Key Errors

**Error Message:** `"API Error (401): Invalid API key"`

**Solutions:**
```
1. Copy your API key again from: https://huggingface.co/settings/tokens
2. Make sure NO spaces are included
3. Generate a NEW token if old one expired
4. Check token has "Read" permissions (minimum required)
```

**Error Message:** `"API Error (403): Llama model access denied"`

**Solutions:**
```
1. Accept terms: https://huggingface.co/meta-llama/Llama-2-7b-chat-hf
2. Click "Agree and access repository"
3. Wait 5 minutes (permission might be propagating)
4. Generate new API token
```

#### Issue: No Response from LLM

**Symptoms:**
- Question submitted, but no response appears
- Loading spinner keeps spinning

**Solutions:**
```javascript
// Check background.js console for:
"Attempt 1 to call Llama LLM..."
"Rate limited, waiting before retry..."
"API Error (429): Too many requests"

// If 429 error (rate limited):
// Free tier has rate limits, wait 30+ seconds

// If model loading:
// First call loads ~14GB model, can take 30-60 seconds
// Subsequent calls are faster

// Check internet connection:
console.log(navigator.onLine)  // Should be true
```

### 4. Check Storage

**To view stored data:**

1. Open DevTools (F12)
2. Application tab → Local Storage
3. Look for entries like:
   - `hfApiKey`: Your API key (masked in display)
   - `scannedFiles`: JSON array of found files
   - `chatHistory`: Your chat conversation

**To clear storage:**

```javascript
// In console:
chrome.storage.local.clear();

// Or in Extension DevTools console:
chrome.storage.local.remove(['hfApiKey', 'scannedFiles', 'chatHistory']);
```

### 5. Test Individual Components

**Test file scanning:**
```javascript
// Run in Brightspace page console:
const files = [];
const selectors = [
  'a[href*=".pdf"]',
  'a[href*=".docx"]',
  'a.d2l-link',
];
selectors.forEach(sel => {
  document.querySelectorAll(sel).forEach(el => {
    console.log(el.textContent, el.href);
  });
});
```

**Test LLM connection:**
```javascript
// In extension DevTools console (background.js):
const apiKey = "your-api-key-here";
fetch('https://api-inference.huggingface.co/models/meta-llama/Llama-2-7b-chat-hf', {
  headers: { Authorization: `Bearer ${apiKey}` },
  method: 'POST',
  body: JSON.stringify({
    inputs: "Say hello",
    parameters: { max_new_tokens: 50 }
  })
}).then(r => r.json()).then(console.log).catch(console.error);
```

**Test storage:**
```javascript
// In extension DevTools console:
chrome.storage.local.set({ testKey: 'testValue' });
chrome.storage.local.get(['testKey'], console.log);
```

### 6. Network Debugging

**To see API calls:**

1. DevTools → Network tab
2. Use extension while Network tab open
3. Look for requests to `api-inference.huggingface.co`
4. Click request → Response tab to see full API response

**Expected successful response:**
```json
[{
  "generated_text": "Your AI response here..."
}]
```

**Common error responses:**
```json
{"error": "Model is loading. Please wait a few moments."}
{"error": "API key is invalid"}
{"error": "Rate limit exceeded"}
```

### 7. Logging Modifications

**Add debug logging to background.js:**

```javascript
// Add at start of functions:
console.log('Function called with:', { question, files });

// Add before API calls:
console.log('Sending to API:', { prompt: prompt.substring(0, 100) + '...' });

// Add after responses:
console.log('Received response:', result);
```

**Add debug logging to content.js:**

```javascript
// In scanForFiles():
console.log('Scanning for files...');
console.log('Found elements:', elements.length);
console.log('File found:', fileInfo);
```

### 8. Chrome Extension Issues

**Extension crashes or doesn't load:**

```
1. Go to chrome://extensions/
2. Disable extension (toggle off)
3. Click "Errors" if shown
4. Read error messages for clues
5. Enable extension again

Common errors:
- Syntax errors in JavaScript
- Missing files in manifest.json
- Invalid JSON in manifest.json
```

**To validate manifest.json:**

```bash
# In terminal:
cat /Users/parkhiagarwal/Downloads/LMS/manifest.json | python3 -m json.tool
```

If there's an error, it shows the line number.

### 9. Reset to Factory Settings

**To start fresh:**

```bash
# 1. Stop the extension:
chrome://extensions/ → Click Remove

# 2. Clean up:
rm -rf /Users/parkhiagarwal/Downloads/LMS/node_modules
rm -rf ~/.config/google-chrome/Default/Local\ Storage/*LMS*

# 3. Verify files:
ls -la /Users/parkhiagarwal/Downloads/LMS/

# 4. Reload in Chrome:
chrome://extensions/ → Load unpacked
```

### 10. Performance Debugging

**To measure response times:**

```javascript
// In popup.js, add timing:
const start = performance.now();
// ... make API call ...
const end = performance.now();
console.log(`Request took ${end - start}ms`);
```

**Monitor slow operations:**

```javascript
// In DevTools Performance tab:
1. Press Record (Ctrl+Shift+E)
2. Use extension
3. Press Record again to stop
4. Review flame chart for bottlenecks
```

## Debug Tips

1. **Always check console first** - Error messages are usually there
2. **Check manifest.json validity** - Syntax errors stop everything
3. **Verify permissions** - Make sure host_permissions are correct
4. **Test one thing at a time** - Isolate the problem
5. **Check API key format** - No spaces, full token copied
6. **Reload extension often** - Changes in source require reload
7. **Clear storage between tests** - Old data can cause issues
8. **Check Brightspace version** - Different versions use different HTML

## Getting Help

If debugging doesn't work:

1. **Screenshot the error** - Include console and error message
2. **Note the URL** - What Brightspace page were you on?
3. **Check timestamps** - When did the error occur?
4. **List your steps** - Exactly what did you do?
5. **Check compatibility** - What version of Chrome? What OS?

## Resources

- Chrome DevTools: https://developer.chrome.com/docs/devtools/
- Extension API: https://developer.chrome.com/docs/extensions/reference/
- Hugging Face API Status: https://status.huggingface.co/
- Brightspace Docs: https://docs.brightspace.com/

---

**Happy debugging! 🐛🔧**
