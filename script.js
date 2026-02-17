const MAX_FILES = 10;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_WIDTH = 1920;

const HEIC_TYPES = ['image/heic', 'image/heif'];

function isHeicFile(file) {
  return (
    HEIC_TYPES.includes(file.type) ||
    /\.heic$/i.test(file.name) ||
    /\.heif$/i.test(file.name)
  );
}

async function convertHeicToJpeg(file) {
  const blob = await heic2any({
    blob: file,
    toType: 'image/jpeg',
    quality: 0.9,
  });
  const jpegBlob = Array.isArray(blob) ? blob[0] : blob;
  const baseName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
  return new File([jpegBlob], baseName, {
    type: 'image/jpeg',
    lastModified: Date.now(),
  });
}

async function ensureImageCanLoad(file) {
  if (isHeicFile(file)) {
    return await convertHeicToJpeg(file);
  }
  return file;
}

const fileInput = document.getElementById('photos');
const previewContainer = document.getElementById('preview');
const uploadForm = document.getElementById('upload-form');
const uploadButton = document.getElementById('upload-button');
const messageEl = document.getElementById('message');
const progressWrapper = document.getElementById('progress-wrapper');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressText = document.getElementById('progress-text');

// TODO: Set this to your deployed backend URL in production
const API_BASE_URL = 'https://wedding-backend-e34z.onrender.com';

let selectedFiles = [];

function setMessage(text, type = '') {
  messageEl.textContent = text;
  messageEl.className = 'message';
  if (type) {
    messageEl.classList.add(`message--${type}`);
  }
}

function resetPreview() {
  previewContainer.innerHTML = '';
}

function updateUploadButtonState() {
  uploadButton.disabled = selectedFiles.length === 0;
}

fileInput.addEventListener('change', async (event) => {
  const files = Array.from(event.target.files || []);
  selectedFiles = [];
  resetPreview();
  setMessage('');

  if (files.length === 0) {
    updateUploadButtonState();
    return;
  }

  if (files.length > MAX_FILES) {
    setMessage(`You can select a maximum of ${MAX_FILES} photos.`, 'error');
  }

  const limitedFiles = files.slice(0, MAX_FILES);

  for (const file of limitedFiles) {
    const isValidImage =
      file.type.startsWith('image/') || isHeicFile(file);
    if (!isValidImage) {
      setMessage('Only image files are allowed.', 'error');
      continue;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setMessage(
        `Each photo must be smaller than 20MB. "${file.name}" is too large.`,
        'error'
      );
      continue;
    }

    selectedFiles.push(file);

    try {
      const loadableFile = await ensureImageCanLoad(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        const item = document.createElement('div');
        item.className = 'col-6 col-sm-4 col-md-3 preview-item';

        const img = document.createElement('img');
        img.src = e.target.result;
        img.alt = file.name;
        img.className = 'preview-thumb';

        const caption = document.createElement('div');
        caption.className = 'preview-caption';
        caption.textContent = file.name;

        item.appendChild(img);
        item.appendChild(caption);
        previewContainer.appendChild(item);
      };
      reader.readAsDataURL(loadableFile);
    } catch (err) {
      console.error('Preview error for', file.name, err);
      setMessage(`Could not preview "${file.name}". It may still upload.`, 'error');
    }
  }

  if (selectedFiles.length === 0 && files.length > 0) {
    setMessage('No valid images selected. Please choose different files.', 'error');
  }

  updateUploadButtonState();
});

function readFileAsImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  const loadableFile = await ensureImageCanLoad(file);
  const image = await readFileAsImage(loadableFile);

  let { width, height } = image;

  if (width <= MAX_WIDTH) {
    return loadableFile;
  }

  const scale = MAX_WIDTH / width;
  width = MAX_WIDTH;
  height = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);

  const quality = 0.85;

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Image compression failed.'));
          return;
        }

        const compressedFile = new File([blob], loadableFile.name, {
          type: 'image/jpeg',
          lastModified: Date.now(),
        });

        resolve(compressedFile);
      },
      'image/jpeg',
      quality
    );
  });
}

async function prepareCompressedFiles(files) {
  const compressedFiles = [];

  for (const file of files) {
    try {
      const compressed = await compressImage(file);
      compressedFiles.push(compressed);
    } catch (error) {
      console.error('Compression error:', error);
      setMessage('One of the images could not be processed. Please try different files.', 'error');
      throw error;
    }
  }

  return compressedFiles;
}

function resetProgress() {
  progressBarFill.style.width = '0%';
  progressText.textContent = 'Preparing...';
}

function setProgress(percent, text) {
  progressBarFill.style.width = `${percent}%`;
  if (text) {
    progressText.textContent = text;
  }
}

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (selectedFiles.length === 0) {
    setMessage('Please select at least one photo.', 'error');
    return;
  }

  uploadButton.disabled = true;
  fileInput.disabled = true;
  setMessage('');
  progressWrapper.hidden = false;
  resetProgress();

  try {
    setProgress(10, 'Compressing images...');
    const compressedFiles = await prepareCompressedFiles(selectedFiles);

    const formData = new FormData();
    compressedFiles.forEach((file) => {
      formData.append('photos', file, file.name);
    });

    setProgress(30, 'Fotoğraflar yükleniyor...');

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.open('POST', `${API_BASE_URL}/upload`, true);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = 30 + (event.loaded / event.total) * 60;
          setProgress(Math.min(95, Math.round(percent)), 'Fotoğraflar yükleniyor...');
        }
      };

      xhr.onreadystatechange = () => {
        if (xhr.readyState === XMLHttpRequest.DONE) {
          try {
            const status = xhr.status;
            const response = xhr.responseText ? JSON.parse(xhr.responseText) : null;

            if (status >= 200 && status < 300 && response && response.success) {
              setProgress(100, 'Bitti!');
              setMessage('Teşekkürler! Fotoğraflarınız başarıyla yüklendi.', 'success');
              resolve(response);
            } else {
              const errorMessage =
                (response && response.error) ||
                'Fotoğraflarınızı yüklerken birşeyler ters gitti. Lütfen tekrar deneyin.';
              setMessage(errorMessage, 'error');
              reject(new Error(errorMessage));
            }
          } catch (error) {
            setMessage(
              'An unexpected error occurred while processing the server response.',
              'error'
            );
            reject(error);
          }
        }
      };

      xhr.onerror = () => {
        setMessage('Could not reach the server. Please check your connection and try again.', 'error');
        reject(new Error('Network error'));
      };

      xhr.send(formData);
    });

    uploadForm.reset();
    selectedFiles = [];
    resetPreview();
    updateUploadButtonState();
  } catch (error) {
    console.error('Upload error:', error);
  } finally {
    uploadButton.disabled = selectedFiles.length === 0;
    fileInput.disabled = false;
    setTimeout(() => {
      progressWrapper.hidden = true;
      resetProgress();
    }, 1200);
  }
});

