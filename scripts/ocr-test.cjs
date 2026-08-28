const Tesseract = require('tesseract.js');
(async () => {
  try {
    console.log('Tesseract version:', Tesseract.version || 'unknown');
    const r = await Tesseract.recognize('C:\\Users\\piopi\\Downloads\\__zakaria_ocr.png', 'eng');
    console.log('OCR_CHARS:', r.data.text.length);
    console.log(r.data.text.slice(0, 800));
  } catch (e) {
    console.log('TESS_FAIL', e && e.message);
    console.log(e && e.stack && e.stack.slice(0, 800));
  }
})();
