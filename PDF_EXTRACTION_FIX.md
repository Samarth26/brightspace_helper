# PDF Extraction Pipeline Fix - Architecture Update

## Problem

The PDF-to-image conversion was failing with the error:
```
Setting up fake worker failed: 'document is not defined'
```

This occurred because the background service worker (background.js) lacks DOM access. PDF.js requires canvas rendering via `document.createElement('canvas')`, which is only available in:
- Content scripts (page context)
- Regular web pages

NOT in service workers.

## Root Cause

**Service Worker Limitation:** MV3 service workers cannot:
- Access `document` or DOM APIs
- Create canvas elements
- Render graphics
- Access the page context

## Solution: Delegation Architecture

The fix moves PDF rendering from the service worker to the content script, which **has full DOM access**.

### Data Flow

```
User Upload
    ↓
popup.js (FileReader)
    ↓ [data URL]
chrome.storage.local
    ↓
popup.js (sends files array to background)
    ↓
background.js (detectS PDF)
    ↓
background.js → content.js [message: 'convertPDFToImages']
    ↓
content.js (loads PDF.js in page context)
    ↓
content.js (document.createElement('canvas'))
    ↓ [canvas rendering]
content.js (canvas.toDataURL → JPEG images)
    ↓
content.js → background.js [images response]
    ↓
background.js (builds vision model message)
    ↓
Hugging Face Router API (vision model + images)
    ↓
LLM sees images + can answer questions
```

## Implementation Changes

### 1. Content Script (content.js)

**Added:**
- `loadPdfJs()` - Dynamically loads PDF.js library in page context
- `convertPDFToImages` message handler
- Canvas rendering with `document.createElement('canvas')`
- Page-by-page rendering with viewport scaling
- JPEG compression (quality 0.8)

**Key Code:**
```javascript
// In content script context (has document)
const canvas = document.createElement('canvas');
canvas.width = viewport.width;
canvas.height = viewport.height;

const context = canvas.getContext('2d');
await page.render({ canvasContext: context, viewport }).promise;

const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
```

### 2. Background Service Worker (background.js)

**Added:**
- `sendMessageToActiveTab()` - Sends messages to content script on active tab
- Updated `extractFromDataURL()` to delegate PDF rendering to content script
- Updated `callLlamaLLMWithRetry()` to support vision model inputs

**Flow:**
1. Detect PDF upload
2. Send `{action: 'convertPDFToImages', pdfDataUrl, fileName}` to content script
3. Wait for images response from content script
4. Return `{type: 'images', data: [...]}` for vision model usage

**Fallback Logic:**
- If content script rendering fails → try text extraction as fallback
- If text extraction fails → return error message

### 3. API Message Format

**Vision Model Message Structure:**
```javascript
messages = [
  { role: 'system', content: 'You are a helpful academic assistant...' },
  {
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
      { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
      // ... more pages
    ]
  }
]
```

This follows the OpenAI vision API format, compatible with Hugging Face Router API.

## Benefits

✅ **PDF pages rendered as images** - Vision models can see actual syllabus content  
✅ **Proper architecture** - Uses correct MV3 delegation patterns  
✅ **Fallback robustness** - If rendering fails, falls back to text extraction  
✅ **Handles large PDFs** - Limits to 20 pages to avoid size limits  
✅ **Better quality** - 2x viewport scaling + 0.8 JPEG compression  

## Testing

1. Open the extension popup
2. Enter Hugging Face API key
3. Drag-and-drop a PDF file
4. Ask a question about the content
5. Check browser console for:
   - ✓ "Converting PDF to images: {filename}"
   - ✓ "Page N rendered to image" (for each page)
   - ✓ "Added N image(s) to vision model message"
   - ✓ Model response with actual extracted content

## Known Limitations

- **Vision model requirement:** Only works with vision-capable models (e.g., Llama with vision, Claude, GPT-4V)
- **Page limit:** Capped at 20 pages to avoid API token limits
- **Viewport scaling:** Set to 2x for clarity (adjust if needed)
- **JPEG quality:** Set to 0.8 balance quality vs file size

## Fallback: Text Extraction

If PDF rendering in content script fails, the system automatically falls back to text extraction using `page.getTextContent()`. This still requires functional PDF.js but doesn't need canvas rendering.

## Next Steps

1. **Test on actual syllabus** - Verify model sees rendered pages
2. **Monitor token usage** - Vision images consume more tokens
3. **Optimize scaling** - Adjust viewport scale if needed (currently 2x)
4. **Consider OCR** - For scanned/image-based PDFs if needed

## Files Modified

- ✅ `background.js` - Added message delegation, vision model support
- ✅ `content.js` - Added PDF.js loading, canvas rendering, image conversion
- ✅ `manifest.json` - (no changes needed, already has web_accessible_resources)

## Debugging

Check extension console (Manage Extensions → Details → Errors/Logs):

```
✓ PDF.js loaded in content script with worker at: chrome-extension://...
Converting PDF to images: filename.pdf
PDF loaded: 5 pages
Page 1 rendered to image
Page 2 rendered to image
...
✓ Converted 5 pages to images
Added 5 image(s) to vision model message
```

If you see errors like `document is not defined`, the fix wasn't applied properly or the content script didn't load.
