// Page-context PDF renderer used by the content script bridge

(function () {
  const SOURCE = 'pdf-renderer';

  function post(type, payload) {
    window.postMessage({ source: SOURCE, type, ...payload }, '*');
  }

  function ensurePdfJs() {
    if (!window.pdfjsLib) {
      throw new Error('pdfjsLib not available in page context');
    }
    return window.pdfjsLib;
  }

  async function renderPdf(dataUrl, fileName, requestId) {
    const pdfjsLib = ensurePdfJs();

    const response = await fetch(dataUrl);
    const arrayBuffer = await response.arrayBuffer();

    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      disableWorker: true,
      useWorkerFetch: false,
      useRangeRequests: false
    });

    const pdf = await loadingTask.promise;
    const images = [];
    const maxPages = Math.min(pdf.numPages, 8);

    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.2 });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        const renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;

        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        if (dataUrl && dataUrl.length > 50) {
          images.push({
            dataUrl,
            pageNum,
            fileName
          });
        }
      } catch (e) {
        // Keep going on page errors
      }
    }

    post('result', { requestId, images });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;

    if (data.type === 'ping') {
      post('ready', {});
      return;
    }

    if (data.type === 'render') {
      renderPdf(data.pdfDataUrl, data.fileName, data.requestId)
        .catch((err) => {
          post('error', { requestId: data.requestId, error: err.message });
        });
    }
  });

  post('ready', {});
})();
