# Testing Guide: PDF Extraction Fix

## Quick Test (5 minutes)

### Step 1: Reload Extension
1. Open `chrome://extensions/`
2. Find "Brightspace LMS Assistant"
3. Click the reload icon (↻)

### Step 2: Open Popup
1. Visit any website
2. Click the extension icon
3. Enter your Hugging Face API key

### Step 3: Upload Test PDF
1. Drag and drop a PDF file (preferably a syllabus)
2. Check popup console: should see "File loaded: filename.pdf"
3. Check background console: should see "Extracted files stored"

### Step 4: Ask a Question
1. Type a question about the PDF content
2. Click "Ask Question"
3. Monitor console for these messages:

**Expected Console Output Sequence:**

```
[Popup] File 1/1 loaded: test.pdf Size: 12345
[Popup] Successfully added file to list

[Background] extractTextFromFiles called with 1 files
[Background] Processing file: test.pdf, type: application/pdf
[Background] ✓ PDF detected - delegating to content script for rendering via canvas

[Content] Sending message to content script on tab 123456
[Content] Converting PDF to images: test.pdf
[Content] ✓ PDF.js loaded in content script with worker at: chrome-extension://xxx/pdf.worker.min.js
[Content] PDF loaded: 3 pages
[Content] Page 1 rendered to image
[Content] Page 2 rendered to image
[Content] Page 3 rendered to image
[Content] ✓ Converted 3 pages to images

[Background] ✓ Content script converted PDF to 3 page images
[Background] === BUILDING PROMPT ===
[Background] Total extracted text: 0 characters
[Background] PDF images available: 3
[Background] === PROMPT BUILT ===

[Background] === BUILDING VISION MODEL MESSAGE WITH 3 IMAGES ===
[Background] Added 3 image(s) to vision model message
[Background] === VISION MESSAGE BUILT ===

[Background] Attempt 1 to call Hugging Face Router with model: meta-llama/Llama-3.3-70B-Instruct...
[Background] === API RESPONSE ===
{
  "choices": [
    {
      "message": {
        "content": "Based on the syllabus image provided, the deadline for..."
      }
    }
  ]
}
[Background] Answer extracted: Based on the syllabus image provided...
```

## Expected Behavior

### Success Indicators ✅
- [ ] "✓ PDF detected - delegating to content script"
- [ ] "Converting PDF to images: filename"
- [ ] "PDF loaded: X pages"
- [ ] "Page N rendered to image" (for each page)
- [ ] "✓ Converted X pages to images"
- [ ] "Added X image(s) to vision model message"
- [ ] Model returns answer mentioning specific content from PDF

### Fallback Behavior (if PDF rendering fails)
- [ ] "Content script PDF rendering failed: [error]"
- [ ] Falls back to text extraction
- [ ] "✓ Fallback: Successfully extracted X chars from PDF"
- [ ] Model responds with text-based answer

## Console Access

### Popup Console
1. Right-click extension icon → "Inspect popup"
2. Opens DevTools with popup scope

### Content Script Console
1. Right-click page → "Inspect"
2. Shows content script logs mixed with page logs

### Background Service Worker Console
1. Open `chrome://extensions/`
2. Find "Brightspace LMS Assistant"
3. Click "service worker" link under "Inspect views"
4. Opens DevTools with background.js scope

## Troubleshooting

### Problem: "No active tab found"
**Cause:** Extension trying to send message but no tab available
**Fix:** 
- Keep the website tab active when asking questions
- Don't switch tabs while processing

### Problem: "document is not defined"
**Cause:** PDF rendering code is still running in service worker
**Fix:**
- Make sure you're using the latest version (reload extension)
- Clear browser cache: `⌘+Shift+Delete`
- Try a fresh incognito window

### Problem: "PDF rendering returns 0 images"
**Cause:** PDF.js failed to load in content script
**Fix:**
- Check manifest.json has `pdf.min.js` and `pdf.worker.min.js` in web_accessible_resources
- Try with a different PDF file
- Check that pdf.min.js and pdf.worker.min.js files exist

### Problem: Model says "Information not available"
**Cause:** Images not being sent to model (text-only mode)
**Fix:**
- Check console for "BUILDING VISION MODEL MESSAGE" 
- Verify images count > 0
- Check that model supports vision (e.g., Llama 3.3 with vision)

### Problem: "CORS error" or "API Error (402)"
**Cause:** Rate limiting or model doesn't support vision
**Fix:**
- Try a different model from dropdown
- Wait a few minutes before retrying
- Use local Ollama if available

## Debug Commands

### Check if PDF.js is accessible
In popup console:
```javascript
chrome.runtime.getURL('pdf.min.js')
// Should output: chrome-extension://xxx/pdf.min.js
```

### Manually trigger PDF conversion
In extension service worker console:
```javascript
// Send test message
chrome.tabs.query({active: true}, (tabs) => {
  chrome.tabs.sendMessage(tabs[0].id, {
    action: 'convertPDFToImages',
    pdfDataUrl: 'data:application/pdf;base64,...',
    fileName: 'test.pdf'
  }, (response) => {
    console.log('Response:', response);
  });
});
```

### Check storage
In any console:
```javascript
chrome.storage.local.get(null, (items) => {
  console.log('Storage:', items);
});
```

## Performance Notes

- **PDF rendering time:** ~500ms-2s per page (depends on complexity)
- **JPEG compression:** 0.8 quality, 2x scale (may adjust if too slow)
- **API response time:** 5-30s (depends on model and image count)
- **Token usage:** ~500-2000 tokens per image (vision models use more)

## Advanced Testing

### Test with Different Models
1. Open popup
2. Select different model from dropdown
3. Try with and without local Ollama
4. Compare response quality

### Test with Large PDFs
1. Upload 20+ page PDF (hits page limit)
2. Should process first 20 pages
3. Check console: "Limit to 20 pages"

### Test Fallback
1. Rename pdf.worker.min.js to pdf.worker.min.js.bak
2. Upload PDF
3. Should see "Content script PDF rendering failed"
4. Should fallback to text extraction
5. Restore file for normal operation

## Expected Limitations

- **No OCR:** Image-based PDFs won't have searchable text (use OCR model if needed)
- **Large files:** PDFs > 50MB may timeout
- **Complex layouts:** Some formatted PDFs may lose structure
- **Page limit:** 20 pages max to stay under API token limits

---

**Need help?** Check the browser console for specific error messages and file paths.
