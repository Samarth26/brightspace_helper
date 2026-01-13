# Brightspace LLM Assistant - Chrome Extension

A powerful Chrome extension that lets you upload course materials, then uses an open-source LLM from Hugging Face to answer questions about deadlines, grading policies, learning objectives, and more.

## Features

- 📥 **Drag-and-Drop Uploads**: Upload PDFs and documents directly from the popup
- 🤖 **AI-Powered Answers**: Uses an open-source LLM via Hugging Face to answer questions about your course materials
- 💬 **Interactive Chat**: Conversational interface to ask questions about:
  - Assignment and exam deadlines
  - Grading policies and rubrics
  - Course learning objectives
  - Course requirements and policies
  - And more!
- 💾 **Drive-Backed Storage**: Uploads files to Google Drive for future RAG
- 🧠 **Optional Vector API**: Store embeddings in MongoDB Atlas and query top-K chunks
- 🔒 **Private**: Processes files locally; only sends text summaries to the LLM API

## Prerequisites

1. **Chrome Browser** (version 88 or later)
2. **Hugging Face API Key** (free tier available)
   - Sign up at [huggingface.co](https://huggingface.co)
   - Get your API key from [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
   - Accept the terms for the selected model access
3. **Google Drive OAuth Client ID**
   - Add your client ID to `manifest.json` (`oauth2.client_id`)
   - Scope used: `https://www.googleapis.com/auth/drive.file`
4. **(Optional) Vector API Server**
   - Node.js 18+ recommended for the MongoDB driver

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

### Uploading Files

1. Click the extension popup icon
2. Click **Authorize Drive** when prompted
3. Drag and drop files into the upload area
4. Files are uploaded to Google Drive immediately

### Asking Questions

1. Once files are uploaded, type your question in the text area
2. Click **"Ask Question"** or press Shift+Enter
3. The extension will:
   - Extract text from the uploaded files
   - Send it to the LLM with your question
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

1. **Background Service Worker** (`background.js`):
   - Receives questions from the popup
   - Fetches and extracts text from uploaded files
   - Creates a context-aware prompt
   - Calls Hugging Face API with the selected model
   - Returns answers to the popup

2. **Popup UI** (`popup.html`, `popup.js`, `popup.css`):
   - User interface for interacting with the extension
   - Uploads files to Google Drive
   - Displays uploaded files
   - Chat interface for questions and answers
   - Stores API key securely in Chrome storage

## LLM Configuration

### Default Model
The extension uses a small language model (SLM) by default via Hugging Face Inference API:
- `google/gemma-2-2b-it`

### Other Available Models
You can modify `background.js` to use alternative models:
- `meta-llama/Llama-3.1-8B-Instruct` (balanced speed/quality)
- `mistralai/Mistral-7B-Instruct-v0.3` (strong general-purpose)
- Other open-source text-only models available on Hugging Face

### RAG & Embeddings
The extension uses a lightweight RAG pipeline to ground answers in your course files:
- Embeddings model: `Qwen/Qwen3-Embedding-8B` via Hugging Face Router
- Chunking: 1200 characters with 150 overlap
- Retrieval: top 8 chunks per query
- Vector store: saved to `vector-store.json` in your Google Drive folder `Brightspace LLM Assistant`

### Optional Vector API (MongoDB Atlas)
You can store embeddings in MongoDB Atlas and retrieve top-K chunks via a local API server.

1. Set up a vector index in MongoDB Atlas on the `embedding` field.
2. Configure the server:
   - Copy `server/.env.example` to `server/.env`
   - Set `MONGODB_URI`, `MONGODB_DB`, `MONGODB_COLLECTION`, and `VECTOR_INDEX_NAME`
3. Start the server:
   - `cd server && npm install`
   - `npm start`
4. In the extension popup, set **Vector API URL** (e.g., `http://localhost:3000/api`).
5. If you set `API_KEY` in `server/.env`, set the same value in **Vector API key** in the popup.

When the Vector API URL is set, the extension stores embeddings in MongoDB and queries top-K chunks from the API.

### Local Alternative (Ollama)
For completely private inference without API keys:

1. Install [Ollama](https://ollama.ai)
2. Run `ollama pull llama3.2:3b-instruct`
3. Start Ollama: `ollama serve`
4. Enable local mode in the popup and set the model name

## Troubleshooting

### API Key errors
- Verify your Hugging Face API key is correct
- Make sure you have accepted the selected model terms on Hugging Face
- Check that your free tier account has API access active

### No response from LLM
- Check your internet connection
- Verify the file wasn't too large (token limits apply)
- Try a simpler question first
- Check Hugging Face service status

### Drive upload issues
- Make sure you authorized Google Drive in the popup
- Check browser console (F12) for OAuth errors
- Verify your OAuth client ID in `manifest.json`

### Vector API errors
- `Invalid API key`: Set **Vector API key** in the popup to match `API_KEY` in `server/.env`, or remove `API_KEY` to disable auth.
- `Failed to connect to MongoDB`: Double-check `MONGODB_URI` credentials and Atlas IP allowlist.

## Privacy & Security

- ✅ Files are processed locally for text extraction
- ✅ Uploaded files are stored in your Google Drive folder `Brightspace LLM Assistant`
- ✅ Vector index is stored in `vector-store.json` in the same Drive folder (if Vector API URL is not set)
- ✅ Vector API mode stores embeddings in MongoDB Atlas
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
- [Gemma Model Card](https://huggingface.co/google/gemma-2-2b-it)
- [Google Drive API](https://developers.google.com/drive/api/guides/about-sdk)

## Disclaimer

This extension is not affiliated with Brightspace, Meta, or Hugging Face. Use it responsibly and in accordance with your institution's policies.
# brightspace_helper
