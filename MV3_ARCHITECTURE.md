# Chrome Extension MV3 Architecture: Service Workers vs Content Scripts

## Why This Matters

The PDF extraction fix required moving canvas rendering from **service worker** to **content script** because of MV3 architectural constraints.

## Service Worker (background.js)

### What It Can Do ✅
- Process long-running tasks without page interference
- Manage background logic (LLM API calls, data processing)
- Access chrome.* APIs (storage, tabs, runtime)
- Listen for user events (extension icon click)
- Handle offscreen operations in MV3

### What It CANNOT Do ❌
- Access `document` or DOM
- Create canvas elements
- Render graphics
- Access `window.fetch` directly (no page context)
- Communicate with page scripts directly
- Use browser APIs that need page context

### Service Worker Lifecycle
```
Extension installed/updated
    ↓
Service worker started
    ↓
Listen for messages (idle state, minimal memory)
    ↓
Event triggered (message, timer, etc.)
    ↓
Handle event
    ↓
Return to idle (stop after callback)
    ↓
Re-start when needed
```

## Content Script (content.js)

### What It Can Do ✅
- Access `document` and DOM API
- Create canvas elements with `document.createElement('canvas')`
- Render graphics
- Access page context safely
- Listen for page events
- Communicate with service worker
- Execute in page scope

### What It CANNOT Do ❌
- Call arbitrary functions from page scripts
- Access most `chrome.storage` APIs directly (can use messaging)
- Execute for long periods (page unload stops it)
- Run on privileged pages (chrome://, about://, etc.)
- Persist state without service worker help

### Content Script Scope
```
Page loads
    ↓
Content script injected
    ↓
Listen for messages from popup/background
    ↓
Process page-related tasks (DOM, canvas, etc.)
    ↓
Send results back to background
    ↓
Page unloads or refreshes
    ↓
Content script stops
```

## Message Passing Pattern

### Background → Content Script (One-Way)
```javascript
// In background.js (service worker)
chrome.tabs.sendMessage(tabId, {
  action: 'convertPDFToImages',
  pdfDataUrl: 'data:application/pdf;...',
  fileName: 'test.pdf'
}, (response) => {
  // Handle response after content script finishes
  console.log('Images:', response.images);
});
```

### Content Script → Background (Response)
```javascript
// In content.js (content script)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'convertPDFToImages') {
    // Process in page context (can access DOM/canvas)
    const images = await renderPDFToImages(request.pdfDataUrl);
    
    // Send back to background
    sendResponse({
      success: true,
      images: images
    });
  }
});
```

## Why PDF.js Required Migration

### Original Approach (Failed)
```
Service Worker (background.js)
    ↓
importScripts('pdf.min.js')
    ↓
pdfjsLib loaded ✅
    ↓
page.render() → document.createElement('canvas')
    ↓
❌ ERROR: document is not defined
```

**Root cause:** Service workers have no `document` object.

### Fixed Approach (Works)
```
Content Script (content.js)
    ↓
Load PDF.js via <script> tag
    ↓
window.pdfjsLib available ✅
    ↓
page.render() → document.createElement('canvas')
    ↓
✅ SUCCESS: Canvas exists in page context
```

## Data Flow: Complete Picture

```
┌─────────────────────────────────────────────────────────────────┐
│ POPUP (popup.js - UI)                                          │
│ - Collect user input (question, files)                         │
│ - Display results                                              │
│ - Limited to popup window scope                               │
└────────────────────┬────────────────────────────────────────────┘
                     │ chrome.runtime.sendMessage({
                     │   action: 'askQuestion',
                     │   files: [...],
                     │   question: '...'
                     │ })
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│ SERVICE WORKER (background.js)                                  │
│ - LLM API calls ✅                                             │
│ - File processing ✅                                           │
│ - Storage management ✅                                        │
│ - PDF RENDERING ❌ (no document)                               │
│                                                                 │
│ → Detects PDF upload                                           │
│ → Cannot render (needs DOM)                                    │
│ → Delegates to content script ↓                               │
└────────────────────┬────────────────────────────────────────────┘
                     │ chrome.tabs.sendMessage({
                     │   action: 'convertPDFToImages',
                     │   pdfDataUrl: 'data:...',
                     │   fileName: 'test.pdf'
                     │ })
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│ CONTENT SCRIPT (content.js - Page Context)                      │
│ - Page interaction ✅                                           │
│ - DOM access ✅                                                │
│ - Canvas rendering ✅ (document.createElement works!)           │
│                                                                 │
│ → Receives PDF data                                            │
│ → Loads PDF.js in page context ✅                              │
│ → Creates canvas for each page                                │
│ → Renders pages to images                                     │
│ → Converts to JPEG data URLs ✅                               │
│ → Returns images to service worker ↓                          │
└────────────────────┬────────────────────────────────────────────┘
                     │ sendResponse({
                     │   success: true,
                     │   images: [{dataUrl, pageNum, ...}, ...]
                     │ })
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│ SERVICE WORKER (background.js - Resumed)                        │
│ - Now has images from content script                           │
│ - Builds vision model message with images                      │
│ - Calls Hugging Face API with vision support                   │
│ - Model sees actual PDF page images                            │
│ - Returns accurate answer ✅                                    │
└────────────────────┬────────────────────────────────────────────┘
                     │ chrome.runtime.sendMessage(
                     │   {answer: '...', success: true}
                     │ ) [to popup]
                     ↓
┌─────────────────────────────────────────────────────────────────┐
│ POPUP (popup.js - Display)                                      │
│ - Shows final answer to user                                    │
│ - User sees syllabus deadline info ✅                           │
└─────────────────────────────────────────────────────────────────┘
```

## Key Architectural Principles

### 1. Separation of Concerns
- **Service Worker:** Long-running logic, external APIs
- **Content Script:** Page interaction, DOM manipulation
- **Popup:** User interface, results display

### 2. Message Passing
- Only reliable communication between contexts
- Async operations with `sendResponse` callback
- Always handle errors in responses

### 3. Scope Awareness
- Service workers: background operations only
- Content scripts: page operations only
- Keep cross-context communication explicit

### 4. Graceful Degradation
- Try primary approach (PDF images via content script)
- Fallback to text extraction if rendering fails
- Clear error messages if all options fail

## MV3 vs MV2 Differences

| Feature | MV2 | MV3 |
|---------|-----|-----|
| Background persistence | Long-lived script | Event-driven service worker |
| DOM access | Background page could access some DOM | Service workers have NO DOM |
| Canvas rendering | Possible in background | MUST use content script |
| Offscreen documents | Not available | OffscreenCanvas for some tasks |
| Message passing | Same as MV3 | Same as MV2 |
| API calls | Direct | Same, but service worker can timeout |

## When to Use Content Script vs Service Worker

### Use Content Script For:
- ✅ DOM manipulation (createElement, DOM queries)
- ✅ Canvas rendering
- ✅ Page context operations
- ✅ Event listeners on page elements
- ✅ Accessing page variables/globals

### Use Service Worker For:
- ✅ Long-running processes (API calls, processing)
- ✅ Scheduled tasks (timers, alarms)
- ✅ Cross-tab coordination (storage updates)
- ✅ Persistent logic (doesn't die on page unload)
- ✅ Chrome extension APIs

## Debugging Architecture Issues

### How to Tell Where Code Is Running

```javascript
// In service worker (background.js)
console.log(typeof document); // undefined
importScripts('...'); // Works

// In content script (content.js)
console.log(typeof document); // 'object' ✅
document.createElement('canvas'); // Works ✅
importScripts('...'); // FAILS - not available in content scripts
```

### Chrome DevTools Tips

1. **Service Worker:** `chrome://extensions/` → "service worker" link
2. **Content Script:** Right-click page → Inspect → Sources tab
3. **Popup:** Right-click extension icon → Inspect popup
4. **Messages:** Check console for message send/receive logs

### Common Error Patterns

| Error | Context | Solution |
|-------|---------|----------|
| `document is not defined` | Service Worker | Move to content script |
| `importScripts is not available` | Content Script | Move to service worker |
| `chrome.* is not available` | Page Script | Move to content/service worker |
| `Cannot read property of undefined` | Wrong scope | Check which file, enable debugging |

## Production Checklist

- [ ] All DOM operations in content script
- [ ] All API calls in service worker
- [ ] Message passing explicit and error-handled
- [ ] Fallback logic for content script failures
- [ ] Console logs for debugging (can be removed for release)
- [ ] Manifest permissions minimal but sufficient
- [ ] web_accessible_resources includes external scripts
- [ ] Content scripts properly scoped to right domains

---

**Key Takeaway:** MV3 enforces architectural separation. Use service workers for logic, content scripts for page interaction. This PDF fix demonstrates that properly.
