// Dedicated renderer tab for PDF-to-image conversion

console.log('=== PDF RENDERER TAB LOADED ===');
console.log('Timestamp:', new Date().toISOString());
console.log('Location:', window.location.href);

let pdfjsReady = false;

async function ensurePdfJsReady() {
  if (pdfjsReady && typeof pdfjsLib !== 'undefined') {
    return pdfjsLib;
  }

  const maxWaitMs = 5000;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    if (typeof pdfjsLib !== 'undefined') {
      const workerUrl = chrome.runtime.getURL('pdf.worker.min.js');
      try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
      } catch (e) {
        console.warn('Failed to set PDF.js worker source:', e);
      }
      pdfjsReady = true;
      return pdfjsLib;
    }
    await new Promise(r => setTimeout(r, 100));
  }

  throw new Error('PDF.js not available in renderer tab');
}

const port = chrome.runtime.connect({ name: 'pdf-renderer' });
port.postMessage({ type: 'ready' });
console.log('✓ Renderer tab ready');

port.onMessage.addListener((message) => {
  if (message?.action === 'convertPDFToImages') {
    handlePDFConversion(message)
      .catch(error => {
        port.postMessage({
          type: 'error',
          requestId: message.requestId,
          error: error.message
        });
      });
  }
});

async function handlePDFConversion(message) {
  const { pdfDataUrl, fileName, requestId } = message;

  console.log(`Converting PDF to images in renderer tab: ${fileName}`);
  await ensurePdfJsReady();

  const response = await fetch(pdfDataUrl);
  const arrayBuffer = await response.arrayBuffer();

  const loadingTask = pdfjsLib.getDocument({
    data: arrayBuffer,
    disableWorker: true,
    useWorkerFetch: false,
    useRangeRequests: false
  });

  const pdf = await loadingTask.promise;
  console.log(`PDF loaded: ${pdf.numPages} pages`);

  const maxPages = Math.min(pdf.numPages, 8);

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    try {
      console.log(`Rendering page ${pageNum}/${maxPages}...`);
      port.postMessage({ type: 'progress', requestId, pageNum });
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.2 });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const context = canvas.getContext('2d');
      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport
      });

      await renderTask.promise;

      const blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.6);
      });

      if (!blob) {
        throw new Error('Failed to create JPEG blob');
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read JPEG blob as data URL'));
        reader.readAsDataURL(blob);
      });

      if (!dataUrl || typeof dataUrl !== 'string') {
        throw new Error('Empty JPEG data URL');
      }

      port.postMessage({
        type: 'page',
        requestId,
        image: {
          dataUrl,
          pageNum: pageNum,
          fileName: fileName
        }
      });

      console.log(`✓ Page ${pageNum}/${maxPages} rendered`);
    } catch (pageError) {
      console.warn(`Error rendering page ${pageNum}:`, pageError);
    }
  }

  port.postMessage({ type: 'done', requestId });
}
