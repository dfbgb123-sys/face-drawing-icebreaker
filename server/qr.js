const QRCode = require('qrcode');

async function toDataUrl(text) {
  return QRCode.toDataURL(text, { margin: 1, scale: 6 });
}

module.exports = { toDataUrl };
