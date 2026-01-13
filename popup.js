// Popup script for Brightspace LLM Assistant

let scannedFiles = [];
let chatHistory = [];
let uploadInProgress = false;
const DRIVE_FOLDER_NAME = 'Brightspace LLM Assistant';

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadApiKey();
  await loadHFModel();
  await loadProxyUrl();
  await loadVectorApiSettings();
  await loadLocalModelSettings();
  await loadScannedFiles();
  await loadChatHistory();
  setupEventListeners();
});

// Load API key from storage
async function loadApiKey() {
  chrome.storage.local.get(['hfApiKey'], (result) => {
    if (result.hfApiKey) {
      document.getElementById('apiKey').value = result.hfApiKey;
      updateApiKeyStatus('API key loaded ✓', false);
    }
  });
}

// Load HF model from storage
async function loadHFModel() {
  chrome.storage.local.get(['hfModel'], (result) => {
    const model = result.hfModel || 'google/gemma-2-2b-it';
    document.getElementById('modelSelect').value = model;
  });
}

// Save HF model
function saveHFModel() {
  const model = document.getElementById('modelSelect').value;
  chrome.storage.local.set({ hfModel: model }, () => {
    updateModelStatus(`✓ Model set to: ${model.split('/')[1]}`, false);
  });
}

function updateModelStatus(message, isError = false) {
  const el = document.getElementById('modelStatus');
  el.textContent = message;
  el.className = isError ? 'status-message error' : 'status-message';
}

// Load uploaded files from storage
async function loadScannedFiles() {
  chrome.storage.local.get(['scannedFiles'], (result) => {
    scannedFiles = result.scannedFiles || [];
    updateFilesList();
    updateFileCount();
  });
}

// Load chat history from storage
async function loadChatHistory() {
  chrome.storage.local.get(['chatHistory'], (result) => {
    chatHistory = result.chatHistory || [];
    renderChatHistory();
  });
}

// Setup event listeners
function setupEventListeners() {
  document.getElementById('saveApiKey').addEventListener('click', saveApiKey);
  document.getElementById('saveModel').addEventListener('click', saveHFModel);
  document.getElementById('saveProxyUrl').addEventListener('click', saveProxyUrl);
  document.getElementById('saveVectorApiUrl').addEventListener('click', saveVectorApiSettings);
  document.getElementById('saveVectorApiKey').addEventListener('click', saveVectorApiSettings);
  document.getElementById('saveLocalModel').addEventListener('click', saveLocalModelSettings);
  document.getElementById('askButton').addEventListener('click', askQuestion);
  document.getElementById('clearFiles').addEventListener('click', clearAllFiles);
  
  // Google Drive sync
  document.getElementById('driveAuth').addEventListener('click', authenticateGoogleDrive);
  document.getElementById('driveReset').addEventListener('click', resetDriveAuth);
  document.getElementById('backupToDrive').addEventListener('click', backupToDrive);
  document.getElementById('restoreFromDrive').addEventListener('click', restoreFromDrive);

  
  // Drag and drop file upload
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  
  dropZone.addEventListener('click', () => fileInput.click());
  
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });
  
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFileUpload(e.dataTransfer.files);
  });
  
  fileInput.addEventListener('change', (e) => {
    handleFileUpload(e.target.files);
  });
  
  // Example questions
  document.querySelectorAll('.example-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const question = e.target.getAttribute('data-question');
      document.getElementById('questionInput').value = question;
    });
  });
  
  // Enter key to submit question
  document.getElementById('questionInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      askQuestion();
    }
  });
}

// Save API key
function saveApiKey() {
  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) {
    updateApiKeyStatus('Please enter an API key', true);
    return;
  }
  
  chrome.storage.local.set({ hfApiKey: apiKey }, () => {
    updateApiKeyStatus('API key saved ✓', false);
  });
}

// Load proxy URL from storage
async function loadProxyUrl() {
  chrome.storage.local.get(['proxyUrl'], (result) => {
    if (result.proxyUrl) {
      document.getElementById('proxyUrl').value = result.proxyUrl;
      updateProxyStatus('Proxy URL loaded ✓', false);
    }
  });
}

// Save proxy URL
function saveProxyUrl() {
  const proxyUrl = document.getElementById('proxyUrl').value.trim();
  if (!proxyUrl) {
    updateProxyStatus('Proxy URL cleared', false);
    chrome.storage.local.remove('proxyUrl');
    return;
  }
  chrome.storage.local.set({ proxyUrl }, () => {
    updateProxyStatus('Proxy URL saved ✓', false);
  });
}

function updateProxyStatus(message, isError) {
  const el = document.getElementById('proxyStatus');
  el.textContent = message;
  el.className = isError ? 'status-message error' : 'status-message';
}

// Load vector API settings from storage
async function loadVectorApiSettings() {
  chrome.storage.local.get(['vectorApiUrl', 'vectorApiKey'], (result) => {
    if (result.vectorApiUrl) {
      document.getElementById('vectorApiUrl').value = result.vectorApiUrl;
      updateVectorApiStatus('Vector API URL loaded ✓', false);
    }
    if (result.vectorApiKey) {
      document.getElementById('vectorApiKey').value = result.vectorApiKey;
    }
  });
}

function saveVectorApiSettings() {
  const vectorApiUrl = document.getElementById('vectorApiUrl').value.trim();
  const vectorApiKey = document.getElementById('vectorApiKey').value.trim();

  chrome.storage.local.set({ vectorApiUrl, vectorApiKey }, () => {
    updateVectorApiStatus(
      vectorApiUrl ? 'Vector API settings saved ✓' : 'Vector API cleared',
      false
    );
  });
}

function updateVectorApiStatus(message, isError) {
  const el = document.getElementById('vectorApiStatus');
  el.textContent = message;
  el.className = isError ? 'status-message error' : 'status-message';
}

// Load local model settings from storage
async function loadLocalModelSettings() {
  chrome.storage.local.get(['useLocalLLM', 'localModelName'], (result) => {
    const useLocal = !!result.useLocalLLM;
    const modelName = result.localModelName || '';
    document.getElementById('useLocalLLM').checked = useLocal;
    document.getElementById('localModelName').value = modelName || 'llama3.2:3b-instruct';
    updateLocalModelStatus(useLocal
      ? `Local mode enabled${modelName ? ` • Model: ${modelName}` : ''}`
      : 'Local mode disabled');
  });
}

// Save local model settings
function saveLocalModelSettings() {
  const useLocal = document.getElementById('useLocalLLM').checked;
  const nameInput = document.getElementById('localModelName').value.trim();
  const localModelName = nameInput || 'llama3.2:3b-instruct';
  chrome.storage.local.set({ useLocalLLM: useLocal, localModelName }, () => {
    updateLocalModelStatus(useLocal
      ? `Saved • Using local model: ${localModelName}`
      : 'Saved • Local mode disabled');
  });
}

function updateLocalModelStatus(message, isError = false) {
  const el = document.getElementById('localModelStatus');
  el.textContent = message;
  el.className = isError ? 'status-message err' : 'status-message ok';
}

// Handle file upload (drag-and-drop or file input)
async function handleFileUpload(files) {
  const uploadStatus = document.getElementById('uploadStatus');
  
  console.log('handleFileUpload called with', files.length, 'files');
  
  if (!files || files.length === 0) {
    updateUploadStatus('No files selected', true);
    return;
  }

  if (uploadInProgress) {
    updateUploadStatus('Upload in progress. Please wait...', true);
    return;
  }
  
  const fileArray = Array.from(files);
  const maxSize = 50 * 1024 * 1024; // 50MB
  
  console.log('Processing files:', fileArray.map(f => ({ name: f.name, type: f.type, size: f.size })));
  
  // Validate files
  const validFiles = [];
  for (const file of fileArray) {
    if (file.size > maxSize) {
      updateUploadStatus(`${file.name} is too large (max 50MB)`, true);
      continue;
    }
    validFiles.push(file);
  }
  
  if (validFiles.length === 0) {
    updateUploadStatus('No valid files to upload', true);
    return;
  }
  
  uploadInProgress = true;
  updateUploadStatus(`Uploading ${validFiles.length} file(s) to Drive...`, false);
  
  try {
    const token = await getDriveToken(true);
    if (!token) {
      updateUploadStatus('Drive authorization required to upload files.', true);
      uploadInProgress = false;
      return;
    }

    const uploadedFiles = [];
    let processed = 0;

    for (const file of validFiles) {
      updateUploadStatus(`Uploading ${processed + 1}/${validFiles.length}: ${file.name}`, false);
      const driveFileId = await uploadFileToDrive(token, file);
      const fileRecord = {
        url: `drive-file://${driveFileId}`,
        name: file.name,
        type: getFileTypeFromName(file.name),
        size: file.size,
        driveFileId,
        driveMimeType: file.type || 'application/octet-stream',
        timestamp: new Date().toISOString(),
        via: 'drive-upload'
      };
      uploadedFiles.push(fileRecord);
      processed += 1;
    }

    chrome.storage.local.get(['scannedFiles'], (result) => {
      const existing = result.scannedFiles || [];
      const updated = [...existing, ...uploadedFiles];
      const unique = Array.from(
        new Map(updated.map(f => [f.driveFileId || f.url, f])).values()
      );

      console.log('Saving to chrome.storage:', unique.length, 'total files');

      chrome.storage.local.set({ scannedFiles: unique }, () => {
        scannedFiles = unique;
        updateFilesList();
        updateFileCount();
        updateUploadStatus(`✓ Uploaded ${uploadedFiles.length} file(s) to Drive`, false);
        console.log('Upload complete!');
      });
    });
  } catch (error) {
    console.error('Upload failed:', error);
    updateUploadStatus(`Upload failed: ${error.message}`, true);
  } finally {
    uploadInProgress = false;
  }
}

// Get file type from filename
function getFileTypeFromName(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'document';
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt')) return 'presentation';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'spreadsheet';
  if (lower.endsWith('.txt')) return 'text';
  return 'unknown';
}

// Update upload status message
function updateUploadStatus(message, isError) {
  const statusEl = document.getElementById('uploadStatus');
  statusEl.textContent = message;
  statusEl.className = isError ? 'status-message error' : 'status-message';
}

// Update API key status message
function updateApiKeyStatus(message, isError) {
  const statusEl = document.getElementById('apiKeyStatus');
  statusEl.textContent = message;
  statusEl.className = isError ? 'status-message error' : 'status-message';
}

// Update files list display
function updateFilesList() {
  const filesList = document.getElementById('filesList');
  
  if (scannedFiles.length === 0) {
    filesList.innerHTML = '<p class="empty-state">No files uploaded yet. Drop files above to get started.</p>';
    return;
  }
  
  filesList.innerHTML = scannedFiles.map(file => {
    const icon = getFileIcon(file.type);
    return `
      <div class="file-item">
        <span class="file-icon">${icon}</span>
        <span class="file-name" title="${file.name}">${file.name}</span>
      </div>
    `;
  }).join('');
}

// Get icon for file type
function getFileIcon(type) {
  const icons = {
    'pdf': '📄',
    'document': '📝',
    'presentation': '📊',
    'spreadsheet': '📈',
    'text': '📃',
    'unknown': '📎'
  };
  return icons[type] || icons['unknown'];
}

// Update file count
function updateFileCount() {
  document.getElementById('fileCountValue').textContent = scannedFiles.length;
}

// Clear all files
function clearAllFiles() {
  if (confirm('Are you sure you want to clear all uploaded files?')) {
    chrome.storage.local.set({ scannedFiles: [] }, () => {
      scannedFiles = [];
      updateFilesList();
      updateFileCount();
    });
  }
}

// Ask question to LLM
async function askQuestion() {
  const question = document.getElementById('questionInput').value.trim();
  
  if (!question) {
    alert('Please enter a question');
    return;
  }
  
  const apiKey = document.getElementById('apiKey').value.trim();
  const useLocalLLM = document.getElementById('useLocalLLM').checked;
  const localModelName = (document.getElementById('localModelName').value || '').trim();
  if (!useLocalLLM && !apiKey) {
    alert('Enter your Hugging Face API key or enable Local Ollama.');
    return;
  }
  
  if (uploadInProgress) {
    alert('File upload in progress. Please wait until uploads finish.');
    return;
  }

  if (scannedFiles.length === 0) {
    alert('No files uploaded yet. Please drop files before asking a question.');
    return;
  }
  
  // Update UI
  const button = document.getElementById('askButton');
  const buttonText = document.getElementById('buttonText');
  const spinner = document.getElementById('loadingSpinner');
  
  button.disabled = true;
  buttonText.classList.add('hidden');
  spinner.classList.remove('hidden');
  
  // Add user message to chat
  addMessageToChat('user', question);
  document.getElementById('questionInput').value = '';
  
  try {
    // Send to background script for processing
    const proxyUrl = document.getElementById('proxyUrl').value.trim();
    const vectorApiUrl = document.getElementById('vectorApiUrl').value.trim();
    const vectorApiKey = document.getElementById('vectorApiKey').value.trim();
    const hfModel = document.getElementById('modelSelect').value;
    let driveAccessToken = null;
    if (scannedFiles.some(file => file.driveFileId)) {
      driveAccessToken = await getDriveToken(false);
      if (!driveAccessToken) {
        alert('Please authorize Google Drive to access uploaded files.');
        button.disabled = false;
        buttonText.classList.remove('hidden');
        spinner.classList.add('hidden');
        return;
      }
    }

    console.log('Sending askQuestion to background:', {
      questionLength: question.length,
      fileCount: scannedFiles.length,
      useLocalLLM,
      localModelName: localModelName || 'llama3.2:3b-instruct',
      hfModel
    });
    const timeoutId = setTimeout(() => {
      console.error('askQuestion timeout: no response from background after 120s');
      addMessageToChat('assistant', 'Error: No response from background service worker.');
      button.disabled = false;
      buttonText.classList.remove('hidden');
      spinner.classList.add('hidden');
    }, 120000);

    const port = chrome.runtime.connect({ name: 'askQuestion' });
    const request = {
      action: 'askQuestion',
      question: question,
      files: scannedFiles,
      apiKey: apiKey,
      driveAccessToken: driveAccessToken,
      proxyUrl: proxyUrl || null,
      vectorApiUrl: vectorApiUrl || null,
      vectorApiKey: vectorApiKey || null,
      useLocalLLM: useLocalLLM,
      localModelName: localModelName || 'llama3.2:3b-instruct',
      hfModel: hfModel
    };

    port.onMessage.addListener((response) => {
      clearTimeout(timeoutId);
      console.log('askQuestion response:', response);
      if (response && response.success) {
        addMessageToChat('assistant', response.answer);
      } else {
        addMessageToChat('assistant', `Error: ${response?.error || 'Unknown error occurred'}`);
      }

      button.disabled = false;
      buttonText.classList.remove('hidden');
      spinner.classList.add('hidden');
      port.disconnect();
    });

    port.postMessage(request);
  } catch (error) {
    console.error('Error asking question:', error);
    addMessageToChat('assistant', `Error: ${error.message}`);
    button.disabled = false;
    buttonText.classList.remove('hidden');
    spinner.classList.add('hidden');
  }
}

// Add message to chat history
function addMessageToChat(role, text) {
  chatHistory.push({ role, text, timestamp: new Date().toISOString() });
  
  // Keep only last 10 messages
  if (chatHistory.length > 10) {
    chatHistory = chatHistory.slice(-10);
  }
  
  // Save to storage
  chrome.storage.local.set({ chatHistory });
  
  // Render
  renderChatHistory();
}

// Render chat history
function renderChatHistory() {
  const chatHistoryEl = document.getElementById('chatHistory');
  
  if (chatHistory.length === 0) {
    chatHistoryEl.innerHTML = '<p class="empty-state">No messages yet</p>';
    return;
  }
  
  chatHistoryEl.innerHTML = chatHistory.map(msg => `
    <div class="chat-message ${msg.role}">
      <div class="role">${msg.role === 'user' ? 'You' : 'Assistant'}</div>
      <div class="text">${escapeHtml(msg.text)}</div>
    </div>
  `).join('');
  
  // Scroll to bottom
  chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Google Drive Integration

async function authenticateGoogleDrive() {
  try {
    const token = await getDriveToken(true);
    if (token) {
      chrome.storage.local.set({ googleAccessToken: token });
      updateDriveStatus('✓ Google Drive authorized', false);
    }
  } catch (error) {
    updateDriveStatus(`Auth failed: ${error.message}`, true);
  }
}

async function resetDriveAuth() {
  try {
    const tokenValue = await getDriveToken(false);
    const token = typeof tokenValue === 'string' ? tokenValue : tokenValue?.token;
    if (token) {
      await chrome.identity.removeCachedAuthToken({ token });
    }
    chrome.storage.local.remove(['googleAccessToken'], () => {
      updateDriveStatus('Drive auth reset. Please authorize again.', false);
    });
  } catch (error) {
    updateDriveStatus(`Reset failed: ${error.message}`, true);
  }
}

async function backupToDrive() {
  try {
    const token = await getDriveToken(false);
    if (!token) {
      updateDriveStatus('Not authorized. Click "Authorize Drive" first.', true);
      return;
    }
    
    updateDriveStatus('Uploading to Drive...', false);
    
    // Get all data to backup
    const data = await new Promise(resolve => {
      chrome.storage.local.get(null, resolve);
    });
    
    // Remove token from backup
    const { googleAccessToken, ...backupData } = data;
    
    const backupContent = JSON.stringify(backupData, null, 2);
    const timestamp = new Date().toISOString().split('T')[0];
    const fileName = `brightspace-backup-${timestamp}.json`;
    
    // Check if file exists and update or create
    const fileId = await findOrCreateDriveFile(token, fileName);
    await uploadToDrive(token, fileId, backupContent, fileName);
    
    updateDriveStatus(`✓ Backed up to Drive (${Object.keys(backupData).length} items)`, false);
  } catch (error) {
    updateDriveStatus(`Backup failed: ${error.message}`, true);
  }
}

async function restoreFromDrive() {
  try {
    const token = await getDriveToken(false);
    if (!token) {
      updateDriveStatus('Not authorized. Click "Authorize Drive" first.', true);
      return;
    }
    
    updateDriveStatus('Downloading from Drive...', false);
    
    const fileName = `brightspace-backup-${new Date().toISOString().split('T')[0]}.json`;
    const fileId = await findOrCreateDriveFile(token, fileName);
    
    if (!fileId) {
      updateDriveStatus('No backup file found on Drive.', true);
      return;
    }
    
    const content = await downloadFromDrive(token, fileId);
    const backupData = JSON.parse(content);
    
    await new Promise(resolve => {
      chrome.storage.local.set(backupData, resolve);
    });
    
    // Reload UI
    scannedFiles = backupData.scannedFiles || [];
    chatHistory = backupData.chatHistory || [];
    updateFilesList();
    updateFileCount();
    renderChatHistory();
    
    updateDriveStatus(`✓ Restored ${Object.keys(backupData).length} items`, false);
  } catch (error) {
    updateDriveStatus(`Restore failed: ${error.message}`, true);
  }
}

async function findOrCreateDriveFile(token, fileName) {
  try {
    const folderId = await ensureDriveFolderId(token);
    if (!folderId) {
      throw new Error('Could not access Drive folder.');
    }

    // Search for existing file
    const query = `name='${fileName}' and '${folderId}' in parents and trashed=false and mimeType='application/json'`;
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
    
    // Create new file
    const metadata = {
      name: fileName,
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
    
    if (createResp.ok) {
      const file = await createResp.json();
      return file.id;
    }
    
    return null;
  } catch (error) {
    console.error('Error finding/creating Drive file:', error);
    throw error;
  }
}

async function uploadToDrive(token, fileId, content, fileName) {
  const boundary = '===============7330845974216740156==';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  
  const metadata = {
    name: fileName,
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
    throw new Error(`Upload failed: ${response.statusText}`);
  }
}

async function downloadFromDrive(token, fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!response.ok) {
    throw new Error(`Download failed: ${response.statusText}`);
  }
  
  return await response.text();
}

function updateDriveStatus(message, isError = false) {
  const el = document.getElementById('driveStatus');
  el.textContent = message;
  el.className = isError ? 'status-message error' : 'status-message ok';
}

async function ensureDriveFolderId(token) {
  const query = `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,name)`;
  const searchResp = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (searchResp.ok) {
    const searchData = await searchResp.json();
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }
  } else {
    const errorText = await searchResp.text().catch(() => '');
    throw new Error(`Drive folder search failed (${searchResp.status}): ${errorText || searchResp.statusText}`);
  }

  const metadata = {
    name: DRIVE_FOLDER_NAME,
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
    const errorText = await createResp.text().catch(() => '');
    throw new Error(`Drive folder create failed (${createResp.status}): ${errorText || createResp.statusText}`);
  }
  const created = await createResp.json();
  return created.id || null;
}

async function getDriveToken(interactive) {
  try {
    const tokenValue = await chrome.identity.getAuthToken({ interactive });
    const token = typeof tokenValue === 'string' ? tokenValue : tokenValue?.token;
    if (token) {
      chrome.storage.local.set({ googleAccessToken: token });
    }
    return token || null;
  } catch (error) {
    updateDriveStatus(`Drive auth error: ${error.message}`, true);
    return null;
  }
}

async function uploadFileToDrive(token, file) {
  const folderId = await ensureDriveFolderId(token);
  if (!folderId) {
    throw new Error('Could not access Drive folder.');
  }

  const metadata = {
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    parents: [folderId]
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Drive upload failed (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  if (!data.id) {
    throw new Error('Drive upload failed: missing file ID');
  }

  return data.id;
}
