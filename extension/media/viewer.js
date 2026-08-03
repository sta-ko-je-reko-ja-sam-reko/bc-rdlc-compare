const config = window.__bclp;

const statusEl = document.getElementById('status');
const stageEl = document.getElementById('stage');
const pageLabel = document.getElementById('pageLabel');
const zoomLabel = document.getElementById('zoomLabel');
const canvasBefore = document.getElementById('canvasBefore');
const canvasAfter = document.getElementById('canvasAfter');

let beforeDoc = null;
let afterDoc = null;
let pageNumber = 1;
let pageCount = 1;
let zoom = 1;

function setStatus(message, isError) {
    if (!message) {
        statusEl.style.display = 'none';
        return;
    }
    statusEl.style.display = 'block';
    statusEl.textContent = message;
    statusEl.classList.toggle('error', Boolean(isError));
}

async function renderPage(doc, canvas) {
    const context = canvas.getContext('2d');
    if (!doc || pageNumber > doc.numPages) {
        canvas.width = 0;
        canvas.height = 0;
        context.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    const page = await doc.getPage(pageNumber);
    const devicePixelRatio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: zoom * devicePixelRatio });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / devicePixelRatio}px`;
    canvas.style.height = `${viewport.height / devicePixelRatio}px`;

    await page.render({ canvasContext: context, viewport }).promise;
}

async function renderBoth() {
    await Promise.all([renderPage(beforeDoc, canvasBefore), renderPage(afterDoc, canvasAfter)]);
    pageLabel.textContent = `${pageNumber} / ${pageCount}`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
}

function goToPage(target) {
    const next = Math.min(Math.max(1, target), pageCount);
    if (next === pageNumber) {
        return;
    }
    pageNumber = next;
    void renderBoth();
}

function setZoom(next) {
    zoom = Math.min(Math.max(0.25, next), 4);
    void renderBoth();
}

async function fitZoom() {
    const doc = beforeDoc || afterDoc;
    if (!doc) {
        return 1;
    }
    const page = await doc.getPage(Math.min(pageNumber, doc.numPages));
    const unscaled = page.getViewport({ scale: 1 });
    const wrap = document.querySelector('#paneBefore .canvasWrap') || document.querySelector('.canvasWrap');
    const available = (wrap ? wrap.clientWidth : window.innerWidth / 2) - 4;
    if (!available || available <= 0) {
        return 1;
    }
    return Math.min(Math.max(0.25, available / unscaled.width), 4);
}

async function applyFitWidth() {
    zoom = await fitZoom();
    await renderBoth();
}

document.querySelectorAll('.segmented button').forEach((button) => {
    button.addEventListener('click', () => {
        document.querySelectorAll('.segmented button').forEach((other) => other.classList.remove('active'));
        button.classList.add('active');
        stageEl.className = `stage mode-${button.dataset.mode}`;
        void renderBoth();
    });
});

document.getElementById('prev').addEventListener('click', () => goToPage(pageNumber - 1));
document.getElementById('next').addEventListener('click', () => goToPage(pageNumber + 1));
document.getElementById('zoomIn').addEventListener('click', () => setZoom(zoom + 0.25));
document.getElementById('zoomOut').addEventListener('click', () => setZoom(zoom - 0.25));
document.getElementById('fitWidth').addEventListener('click', () => void applyFitWidth());

document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        goToPage(pageNumber + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        goToPage(pageNumber - 1);
    }
});

async function main() {
    try {
        const pdfjs = await import(config.pdfjs);
        pdfjs.GlobalWorkerOptions.workerSrc = config.worker;

        [beforeDoc, afterDoc] = await Promise.all([
            pdfjs.getDocument({ url: config.before }).promise,
            pdfjs.getDocument({ url: config.after }).promise,
        ]);

        pageCount = Math.max(beforeDoc.numPages, afterDoc.numPages);

        if (beforeDoc.numPages !== afterDoc.numPages) {
            setStatus(
                `Page counts differ: environment layout has ${beforeDoc.numPages}, workspace layout has ${afterDoc.numPages}.`,
                true,
            );
        } else {
            setStatus(null);
        }

        await applyFitWidth();
    } catch (error) {
        setStatus(`Could not display the documents: ${error && error.message ? error.message : error}`, true);
    }
}

void main();
