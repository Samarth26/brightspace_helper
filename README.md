# Brightspace LLM Assistant - Chrome Extension

A powerful Chrome extension that scans Brightspace course pages for syllabus, assignments, and course materials, then uses open-source Llama LLM from Hugging Face to answer questions about deadlines, grading policies, learning objectives, and more.

## Features

- 📚 **Automatic File Scanning**: Detects and extracts all files (PDFs, documents, presentations) from Brightspace pages
- 🤖 **AI-Powered Answers**: Uses Llama LLM via Hugging Face to answer questions about your course materials
- 💬 **Interactive Chat**: Conversational interface to ask questions about:
  - Assignment and exam deadlines
  - Grading policies and rubrics
  - Course learning objectives
  - Course requirements and policies
  - And more!
- 💾 **Smart Caching**: Stores scanned files and chat history locally
- 🔒 **Private**: Processes files locally; only sends text summaries to the LLM API

## Prerequisites

1. **Chrome Browser** (version 88 or later)
2. **Hugging Face API Key** (free tier available)
   - Sign up at [huggingface.co](https://huggingface.co)
   - Get your API key from [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
   - Accept the terms for the selected Llama model access

## Installation

### Step 1: Download/Clone the Extension

```bash
cd /Users/parkhiagarwal/Downloads/LMS
```

### Step 2: Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **"Load unpacked"**
4. Select the LMS extension folder
5. The extension should appear in your Chrome extensions list

### Step 3: Configure the Extension

1. Click the extension icon in the Chrome toolbar
2. Enter your Hugging Face API key in the "Hugging Face API Key" field
3. Click **Save**

## Usage

### Scanning Brightspace for Files

1. Navigate to a Brightspace course page (Content, Syllabus, Assessments, etc.)
2. Click the extension popup icon
3. Click the **"🔍 Scan This Page"** button
4. The extension will find and list all documents on the page

### Asking Questions

1. Once files are scanned, type your question in the text area
2. Click **"Ask Question"** or press Shift+Enter
3. The extension will:
   - Extract text from the scanned files
   - Send it to Llama LLM with your question
   - Display the answer in the chat

### Quick Question Templates

Use the suggested questions to quickly ask common queries:
- 📅 **Upcoming deadlines** - Get all assignment and exam dates
- 📊 **Grading policy** - Learn how your grade is calculated
- 🎯 **Learning objectives** - Understand course goals

## File Structure

```
LMS/
├── manifest.json          # Extension configuration
├── background.js          # Service worker (LLM communication)
├── content.js             # Page scanning script
├── popup.html             # Extension UI
├── popup.js               # Popup logic
├── popup.css              # Styling
├── utils.js               # Text extraction utilities
├── README.md              # This file
└── icons/                 # Extension icons
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## How It Works

1. **Content Script** (`content.js`):
   - Runs on Brightspace pages
   - Scans the DOM for file links
   - Extracts file URLs, names, and types

2. **Background Service Worker** (`background.js`):
   - Receives questions from the popup
   - Fetches and extracts text from files
   - Creates a context-aware prompt
   - Calls Hugging Face API with Llama model
   - Returns answers to the popup

3. **Popup UI** (`popup.html`, `popup.js`, `popup.css`):
   - User interface for interacting with the extension
   - Displays scanned files
   - Chat interface for questions and answers
   - Stores API key securely in Chrome storage

## LLM Configuration

### Default Model
The extension uses a small language model (SLM) by default via Hugging Face Inference API:
- `meta-llama/Llama-3.2-3B-Instruct`

### Other Available Llama Models
You can modify `background.js` to use alternative models:
- `meta-llama/Llama-3.2-11B-Vision-Instruct` (larger, more capable)
- `meta-llama/Llama-3.1-8B-Instruct` (balanced speed/quality)
- Other open-source models available on Hugging Face

### RAG & Embeddings
The extension uses a lightweight RAG pipeline to ground answers in your course files:
- Embeddings model: `Qwen/Qwen3-Embedding-8B` via Hugging Face Router
- Chunking: 1200 characters with 150 overlap
- Retrieval: top 8 chunks per query

### Local Alternative (Ollama)
For completely private inference without API keys:

1. Install [Ollama](https://ollama.ai)
2. Run `ollama pull llama3.2:3b-instruct`
3. Start Ollama: `ollama serve`
4. Uncomment `callLlamaLLMLocal()` in `background.js`

## Troubleshooting

### "Unable to scan this page"
- Make sure you're on an actual Brightspace page (*.brightspace.com or *.d2l.com)
- The page needs to be fully loaded
- Check browser console (F12) for errors

### API Key errors
- Verify your Hugging Face API key is correct
- Make sure you have accepted the Llama model terms on Hugging Face
- Check that your free tier account has API access active

### No response from LLM
- Check your internet connection
- Verify the file wasn't too large (token limits apply)
- Try a simpler question first
- Check Hugging Face service status

### Files not detected
- Some Brightspace pages use dynamic loading
- Wait a few seconds after page loads before scanning
- Try refreshing the page and scanning again
- Check browser console for any blocked requests

## Privacy & Security

- ✅ Files are processed locally in your browser
- ✅ API key is stored only in Chrome local storage
- ✅ Only text content is sent to the LLM API
- ⚠️ Your Hugging Face API key is visible to Hugging Face services
- ⚠️ Don't share your API key with others

## Limitations

- **Token Limits**: LLM has context window limits (~2000 tokens for free tier)
- **File Types**: Currently best with text-based files (PDF, TXT, DOCX); requires pdf.js for PDF extraction
- **Accuracy**: LLM responses are AI-generated and may contain errors
- **Rate Limits**: Free tier Hugging Face has rate limits
- **Large Files**: Very large files may be truncated to fit token limits

## Future Enhancements

- [ ] Add support for multiple file formats (images, audio)
- [ ] Implement local PDF.js for better PDF extraction
- [ ] Add mammoth.js for better DOCX support
- [ ] Support for document summarization
- [ ] Custom prompt templates for different question types
- [ ] Integration with other learning platforms (Canvas, Moodle, etc.)
- [ ] Multi-language support
- [ ] Offline mode with local LLM

## Contributing

Feel free to extend and modify this extension:
1. Add better file parsing (pdf.js, mammoth.js)
2. Support more file types
3. Improve the UI/UX
4. Add more LLM providers
5. Optimize token usage

## License

This project is provided as-is for educational purposes.

## Support & Questions

For issues or questions:
1. Check the troubleshooting section
2. Review browser console errors (F12)
3. Check Hugging Face API documentation
4. Review Chrome extension documentation

## Resources

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [Hugging Face API Docs](https://huggingface.co/docs/api-inference/index)
- [Llama Model Card](https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct)
- [Brightspace API (if needed)](https://docs.brightspace.com/en/content/integrations/rest/overview.htm)

## Disclaimer

This extension is not affiliated with Brightspace, Meta, or Hugging Face. Use it responsibly and in accordance with your institution's policies.
# brightspace_helper
