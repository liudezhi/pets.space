export async function preparePhoto(file) {
  const signatures = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const startsWith = (bytes, offset = 0) => bytes.every((byte, i) => signatures[offset + i] === byte);
  const jpeg = startsWith([0xff, 0xd8, 0xff]);
  const png = startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const webp = startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8);
  if (!jpeg && !png && !webp) throw new Error('请选择 JPEG、PNG 或 WebP 格式的照片。');
  if (file.size > 16 * 1024 * 1024) throw new Error('这张照片超过 16 MB，请选用较小的照片。');
  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error('无法读取这张照片，请重新选择。');
    }
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法处理照片，请换用支持画布的浏览器。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let result = canvas.toDataURL('image/webp', 0.83);
    if (result.length > 2 * 1024 * 1024) result = canvas.toDataURL('image/webp', 0.64);
    if (!result.startsWith('data:image/webp;base64,'))
      throw new Error('当前浏览器无法生成 WebP 照片，请更换浏览器再试。');
    return { preview: result, mime: jpeg ? 'image/jpeg' : png ? 'image/png' : 'image/webp' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function readOriginal(file, mime) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取原始照片。'));
    reader.onload = () => resolve({ original: reader.result.split(',')[1], mime });
    reader.readAsDataURL(file);
  });
}
