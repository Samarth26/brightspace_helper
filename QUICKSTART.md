# Quick Start Guide - Brightspace LLM Assistant

## 5-Minute Setup

### 1. Get Your Hugging Face API Key (2 minutes)

1. Go to [huggingface.co](https://huggingface.co)
2. Click **Sign up** (top right) or **Sign in** if you have an account
3. Go to [Settings → Tokens](https://huggingface.co/settings/tokens)
4. Click **New token** → Name it "Brightspace Extension"
5. Select **Read** access type
6. Click **Create token**
7. Copy the token (you'll use this in the extension)

### 2. Accept Llama Model License (1 minute)

1. Visit [meta-llama/Llama-2-7b-chat-hf](https://huggingface.co/meta-llama/Llama-2-7b-chat-hf)
2. Click **"Agree and access repository"** to accept the terms
3. Done! Your account now has access to Llama models

### 3. Install the Extension (2 minutes)

#### Using Developer Mode:

1. Open Chrome and go to **chrome://extensions**
2. Toggle **Developer mode** ON (top right corner)
3. Click **"Load unpacked"**
4. Navigate to and select your `LMS` folder
5. The extension appears in your extensions list!

#### Add to Chrome Toolbar (Optional):

1. Click the puzzle icon (Extensions) on toolbar
2. Find "Brightspace LLM Assistant"
3. Click the pin icon to add to toolbar

### 4. Configure the Extension (1 minute)

1. Click the extension icon in your toolbar
2. Paste your Hugging Face API key into the text field
3. Click **Save**
4. You should see "API key saved ✓" in green

## Using the Extension

### Basic Workflow:

```
1. Navigate to a Brightspace course page
2. Click the extension icon → Click "Scan This Page"
3. Wait for files to be detected
4. Type your question in the chat box
5. Click "Ask Question" or press Shift+Enter
6. Wait for AI response
```

### Example Questions:

- "When is the final assignment due?"
- "What's the grading breakdown?"
- "What are the course learning objectives?"
- "What are the attendance requirements?"
- "What are the makeup exam policies?"

## Troubleshooting

### "Invalid API Key" Error
- Check that your API key is copied correctly (no spaces)
- Make sure you accepted the Llama model terms
- Try creating a new token

### "Unable to scan this page"
- Make sure you're on a Brightspace course page (*.d2l.com or *.brightspace.com)
- Wait 3-5 seconds after page loads before scanning
- Try refreshing the page

### No response from AI
- Check your internet connection
- Try a simpler question first
- Wait 30 seconds (API might be loading model)
- Check if HuggingFace has scheduled maintenance

### "No files scanned yet"
- Click "Scan This Page" first
- The page needs to be fully loaded
- Brightspace files might be in embedded viewers

## Tips & Tricks

### For Better Answers:
- Ask specific questions about deadlines, policies, or requirements
- The AI works best with course materials that are clearly formatted
- Longer, more detailed questions get better answers

### To Clear Data:
- Click "Clear All Files" to remove scanned documents
- Your API key is stored securely (only in Chrome storage)
- Chat history is cleared when you click the clear button

### For More Features:
- You can modify the extension by editing the source files
- See README.md for advanced customization options
- Check background.js to change the LLM model or settings

## What's Happening Behind the Scenes?

1. **Content Script** (content.js)
   - Scans the Brightspace page for file links
   - Finds PDFs, documents, syllabi, etc.

2. **Your Computer**
   - Downloads and extracts text from files
   - This all happens locally - files don't leave your computer

3. **Hugging Face API**
   - Sends a summary of the files + your question
   - Llama 2 AI model processes it
   - Returns an answer

4. **The Extension**
   - Shows you the answer in the popup
   - Saves your chat history

## Need More Help?

- Check **README.md** for full documentation
- Review browser console (F12 → Console) for error messages
- Visit [Hugging Face Docs](https://huggingface.co/docs)
- Check [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| API key won't save | Refresh the popup and try again |
| No files found | Wait for page to fully load, then scan |
| Slow responses | The API might be loading the model (first call is slower) |
| Errors about tokens | Your file might be too large; try asking about specific sections |
| Extension not working | Close and reopen Chrome, or reload the extension in chrome://extensions |

## Next Steps

- Explore different course pages
- Try asking various types of questions
- Share feedback or suggestions for improvements!

---

**Enjoy using your Brightspace LLM Assistant! 🚀**


---

## 🆕 PDF Extraction Fix (IMPORTANT UPDATE)

### What Changed?
PDF files now work properly! They are converted to images and sent to vision-capable models.

### How to Use:
1. **Reload the extension**: chrome://extensions/ → Find extension → Click reload ↻
2. **Drop a PDF**: Drag and drop any syllabus PDF into the extension popup
3. **Ask questions**: "When is the final exam?" etc.
4. **Check console**: Right-click popup → Inspect → See "Converted X pages to images"

### Success Indicators:
✓ "PDF detected - delegating to content script"
✓ "Converting PDF to images: filename.pdf"  
✓ "Page 1 rendered to image"
✓ "Added X image(s) to vision model message"

### If It Doesn't Work:
- Make sure you reloaded the extension
- Check browser console for errors
- See TESTING_GUIDE.md for detailed debugging

### More Details:
- **PDF_EXTRACTION_FIX.md** - Technical explanation
- **TESTING_GUIDE.md** - Comprehensive testing steps
- **MV3_ARCHITECTURE.md** - Architecture deep dive

