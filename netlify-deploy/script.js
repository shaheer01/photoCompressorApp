// Global Variables
let uploadedFiles = [];
let compressedFiles = [];
let compressionQueue = [];
let isProcessing = false;
let currentUser = null;

// Stripe Configuration
let stripe = null;
try {
    // Only initialize Stripe if we have a real key
    const stripeKey = 'pk_test_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    if (stripeKey && !stripeKey.includes('XXXX')) {
        stripe = Stripe(stripeKey);
    }
} catch (error) {
    console.log('Stripe not initialized - payments disabled');
}

const STRIPE_PRICES = {
    monthly: 'price_XXXXXXXXXXXXXX', // Replace with your monthly price ID
    yearly: 'price_XXXXXXXXXXXXXX'   // Replace with your yearly price ID
};

// DOM Elements
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const qualitySlider = document.getElementById('qualitySlider');
const qualityValue = document.getElementById('qualityValue');
const presetButtons = document.querySelectorAll('.preset-btn');
const processingSection = document.getElementById('processingSection');
const processingList = document.getElementById('processingList');
const queueCount = document.getElementById('queueCount');
const clearQueueBtn = document.getElementById('clearQueue');
const resultsSection = document.getElementById('resultsSection');
const resultsGrid = document.getElementById('resultsGrid');
const loginModal = document.getElementById('loginModal');
const authForm = document.getElementById('authForm');

// Initialize Application
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM Content Loaded - ImageOptim starting...');
    
    // Small delay to ensure all elements are fully loaded
    setTimeout(() => {
        console.log('Initializing app components...');
        initializeEventListeners();
        checkUserAuthentication();
        initializeAds();
        initializePremiumFeatures();
    }, 100);
    
    // Fallback initialization in case DOMContentLoaded fires before script loads
    setTimeout(() => {
        if (!document.querySelector('a[href="#login"]')?.onclick && !document.querySelector('a[href="#login"]')?.getAttribute('data-initialized')) {
            console.log('Fallback initialization triggered');
            checkUserAuthentication();
        }
    }, 500);
    
    // Wait a bit for library to load then check
    setTimeout(() => {
        if (window.compressionLibraryLoaded === true) {
            console.log('✅ CompressorJS library loaded successfully');
        } else if (window.compressionLibraryLoaded === 'canvas-only') {
            console.log('⚠️ Using canvas-only compression (external library failed)');
            showNotification('Using built-in compression (external library unavailable)', 'info');
        } else {
            console.log('⏳ Still loading compression library...');
        }
    }, 2000);
});

// Event Listeners
function initializeEventListeners() {
    // Upload area events
    uploadArea.addEventListener('click', (e) => {
        // Prevent event bubbling
        e.stopPropagation();
        
        // Only trigger file input if clicking the upload area itself, not child elements
        if (e.target === uploadArea || uploadArea.contains(e.target)) {
            console.log('Upload area clicked, triggering file input');
            fileInput.click();
        }
    });
    
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
    
    // File input change
    fileInput.addEventListener('change', handleFileSelect);
    
    // Browse button
    const browseBtn = document.getElementById('browseBtn');
    if (browseBtn) {
        browseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('Browse button clicked');
            fileInput.click();
        });
    }
    
    // Quality slider
    qualitySlider.addEventListener('input', updateQualityValue);
    
    // Preset buttons
    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => setQualityPreset(btn));
    });
    
    // Clear queue button
    clearQueueBtn.addEventListener('click', clearQueue);
    
    // Authentication - handled by updateAuthUI() function
    
    authForm.addEventListener('submit', handleAuthentication);
    
    // Hero buttons
    document.querySelector('.hero-buttons .btn-primary').addEventListener('click', () => {
        document.getElementById('compress').scrollIntoView({ behavior: 'smooth' });
    });
    
    document.querySelector('.hero-buttons .btn-secondary').addEventListener('click', () => {
        document.getElementById('about').scrollIntoView({ behavior: 'smooth' });
    });
}

// Drag and Drop Functionality
function handleDragOver(e) {
    e.preventDefault();
    uploadArea.classList.add('dragover');
}

function handleDragLeave(e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
}

function handleDrop(e) {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    
    const files = Array.from(e.dataTransfer.files);
    processFilesWithPremiumCheck(files);
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    console.log('Files selected:', files.length, files.map(f => f.name));
    
    // Prevent processing if no files selected
    if (files.length === 0) {
        console.log('No files selected, returning early');
        return;
    }
    
    // Clear the input immediately to prevent issues
    e.target.value = '';
    
    // Process files with a small delay to ensure DOM is ready
    setTimeout(() => {
        processFilesWithPremiumCheck(files);
    }, 50);
}

function validateFile(file) {
    console.log('Validating file:', file.name, file.type, file.size);
    
    // Check file type - accept both image/jpeg and image/jpg, plus empty MIME types with valid extensions
    const hasValidMimeType = file.type === '' || file.type.match(/^image\/(jpeg|jpg)$/i);
    const hasValidExtension = file.name.toLowerCase().match(/\.(jpg|jpeg)$/);
    
    console.log('File MIME type:', file.type, 'MIME type valid:', hasValidMimeType, 'Extension valid:', hasValidExtension);
    
    // Accept if extension is valid, even if MIME type is problematic
    if (!hasValidExtension) {
        console.log('File validation failed - invalid extension');
        showNotification(`${file.name} is not a valid JPEG file (must end in .jpg or .jpeg)`, 'error');
        return false;
    }
    
    // Warn about MIME type issues but don't block processing
    if (!hasValidMimeType && file.type !== '') {
        console.log('Warning: Unusual MIME type detected, but extension is valid');
        showNotification(`${file.name} has an unusual MIME type but will be processed`, 'warning');
    }
    
    // Check file size (10MB limit for free users)
    const maxSize = currentUser?.isPremium ? Infinity : 10 * 1024 * 1024;
    if (file.size > maxSize) {
        console.log('File validation failed - size too large');
        showNotification(`${file.name} exceeds the ${formatFileSize(maxSize)} size limit`, 'error');
        return false;
    }
    
    // Additional integrity checks
    if (file.size === 0) {
        console.log('File validation failed - empty file');
        showNotification(`${file.name} appears to be empty`, 'error');
        return false;
    }
    
    console.log('File validation passed');
    return true;
}

// File integrity check using FileReader (more lenient)
function checkFileIntegrity(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const arrayBuffer = e.target.result;
                const bytes = new Uint8Array(arrayBuffer);
                
                console.log('Checking file signature for:', file.name);
                console.log('First 10 bytes:', Array.from(bytes).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
                
                // Check for various JPEG signatures
                const isValidJPEG = (
                    // Standard JPEG signature: FF D8 FF
                    (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) ||
                    // Alternative JPEG signature: FF D8 FF E0 (JFIF)
                    (bytes.length >= 4 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF && bytes[3] === 0xE0) ||
                    // Alternative JPEG signature: FF D8 FF E1 (EXIF)
                    (bytes.length >= 4 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF && bytes[3] === 0xE1) ||
                    // Just check for JPEG start marker: FF D8
                    (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xD8)
                );
                
                if (isValidJPEG) {
                    console.log('✅ File integrity check passed for:', file.name);
                    resolve(true);
                } else {
                    console.log('⚠️ File integrity check questionable for:', file.name, '- will try compression anyway');
                    // Don't reject, just resolve with warning
                    resolve(true);
                }
            } catch (error) {
                console.log('File integrity check error:', error, '- will try compression anyway');
                // Don't reject, just resolve
                resolve(true);
            }
        };
        
        reader.onerror = function() {
            console.log('Failed to read file for integrity check - will try compression anyway');
            // Don't reject, just resolve
            resolve(true);
        };
        
        // Read first 20 bytes to check signature
        reader.readAsArrayBuffer(file.slice(0, 20));
    });
}

function addToQueue(file) {
    // Check if file is already in queue to prevent duplicates
    const existingFile = compressionQueue.find(item => 
        item.file.name === file.name && 
        item.file.size === file.size && 
        item.file.lastModified === file.lastModified
    );
    
    if (existingFile) {
        showNotification(`${file.name} is already in the queue`, 'warning');
        return;
    }
    
    const queueItem = {
        id: Date.now() + Math.random(),
        file: file,
        status: 'pending',
        progress: 0,
        originalSize: file.size,
        compressedSize: null,
        compressedBlob: null
    };
    
    compressionQueue.push(queueItem);
    updateQueueDisplay();
    showProcessingSection();
}

// Queue Management
function updateQueueDisplay() {
    queueCount.textContent = `(${compressionQueue.length} files)`;
    
    processingList.innerHTML = '';
    
    // Add overall progress bar if multiple files
    if (compressionQueue.length > 1) {
        const overallProgress = document.createElement('div');
        overallProgress.className = 'overall-progress';
        overallProgress.id = 'overallProgress';
        overallProgress.innerHTML = `
            <div class="overall-progress-label">Overall Progress: <span id="overallProgressText">0%</span></div>
            <div class="overall-progress-bar">
                <div class="overall-progress-fill" id="overallProgressFill" style="width: 0%"></div>
            </div>
        `;
        processingList.appendChild(overallProgress);
    }
    
    compressionQueue.forEach(item => {
        const element = createQueueItemElement(item);
        processingList.appendChild(element);
    });
}

function updateOverallProgress(completed, total) {
    const overallProgressText = document.getElementById('overallProgressText');
    const overallProgressFill = document.getElementById('overallProgressFill');
    
    if (overallProgressText && overallProgressFill && total > 0) {
        const percentage = Math.round((completed / total) * 100);
        overallProgressText.textContent = `${completed}/${total} files (${percentage}%)`;
        overallProgressFill.style.width = `${percentage}%`;
    }
}

function createQueueItemElement(item) {
    const div = document.createElement('div');
    div.className = 'processing-item';
    div.id = `queue-item-${item.id}`;
    div.innerHTML = `
        <div class="file-info">
            <div class="file-status ${item.status}" id="status-${item.id}">
                ${item.status === 'pending' ? '<i class="fas fa-clock"></i>' : 
                  item.status === 'processing' ? '<i class="fas fa-spinner fa-spin"></i>' :
                  item.status === 'completed' ? '<i class="fas fa-check"></i>' :
                  '<i class="fas fa-times"></i>'}
            </div>
            <div>
                <div class="file-name">${item.file.name}</div>
                <div class="file-size">${formatFileSize(item.file.size)}</div>
                ${item.status === 'error' && item.error ? `<div class="error-message">${item.error}</div>` : ''}
            </div>
        </div>
        <div class="queue-actions">
            <div class="progress-bar">
                <div class="progress-fill" id="progress-${item.id}" style="width: ${item.progress}%"></div>
            </div>
            <div class="retry-container" id="retry-${item.id}"></div>
        </div>
    `;
    return div;
}

async function startProcessing() {
    if (isProcessing) return;
    
    isProcessing = true;
    
    const pendingItems = compressionQueue.filter(item => item.status === 'pending');
    let processedCount = 0;
    
    console.log(`Starting processing of ${pendingItems.length} files`);
    
    for (let item of pendingItems) {
        if (item.status === 'pending') {
            console.log(`Processing file ${processedCount + 1} of ${pendingItems.length}: ${item.file.name}`);
            
            // Update overall progress
            updateOverallProgress(processedCount, pendingItems.length);
            
            await processQueueItem(item);
            processedCount++;
        }
    }
    
    // Final progress update
    updateOverallProgress(processedCount, pendingItems.length);
    
    isProcessing = false;
    showResults();
    
    console.log('Processing complete');
}

async function processQueueItem(item) {
    try {
        updateQueueItemStatus(item.id, 'processing', 5);
        
        // Check file integrity (non-blocking)
        try {
            await checkFileIntegrity(item.file);
            console.log('File integrity check completed for:', item.file.name);
        } catch (integrityError) {
            console.log('File integrity check had issues, but continuing with compression:', integrityError);
            // Don't throw error, just log and continue
        }
        
        updateQueueItemStatus(item.id, 'processing', 10);
        
        const quality = parseInt(qualitySlider.value) / 100;
        
        // Choose compression method based on library availability
        let compressedBlob;
        
        if (window.compressionLibraryLoaded === true && typeof Compressor !== 'undefined') {
            // Try CompressorJS library
            try {
                compressedBlob = await Promise.race([
                    compressImage(item.file, quality),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Compression timeout')), 30000)
                    )
                ]);
            } catch (libraryError) {
                console.log('Library compression failed, trying canvas method:', libraryError);
                updateQueueItemStatus(item.id, 'processing', 50);
                try {
                    compressedBlob = await compressWithCanvas(item.file, quality);
                } catch (canvasError) {
                    console.log('Canvas compression also failed, trying direct file processing:', canvasError);
                    updateQueueItemStatus(item.id, 'processing', 70);
                    compressedBlob = await compressWithDirectProcessing(item.file, quality);
                }
            }
        } else {
            // Use canvas compression directly
            console.log('Using canvas compression (library not available)');
            updateQueueItemStatus(item.id, 'processing', 30);
            try {
                compressedBlob = await compressWithCanvas(item.file, quality);
            } catch (canvasError) {
                console.log('Canvas compression failed, trying direct file processing:', canvasError);
                updateQueueItemStatus(item.id, 'processing', 60);
                compressedBlob = await compressWithDirectProcessing(item.file, quality);
            }
        }
        
        updateQueueItemStatus(item.id, 'processing', 90);
        
        // Validate compressed blob
        if (!compressedBlob || compressedBlob.size === 0) {
            throw new Error('Invalid compressed file');
        }
        
        item.compressedBlob = compressedBlob;
        item.compressedSize = compressedBlob.size;
        item.status = 'completed';
        
        updateQueueItemStatus(item.id, 'completed', 100);
        
        // Add to results
        compressedFiles.push(item);
        
        showNotification(`${item.file.name} compressed successfully!`, 'success');
        
    } catch (error) {
        console.error('Compression failed for', item.file.name, ':', error);
        
        // Mark as failed
        item.status = 'error';
        item.error = error.message;
        updateQueueItemStatus(item.id, 'error', 0);
        
        // Show detailed error message
        let errorMessage = `Failed to compress ${item.file.name}`;
        if (error.message === 'Compression timeout') {
            errorMessage += ' (timeout - file may be too large)';
        } else if (error.message.includes('corrupted')) {
            errorMessage += ' (file appears to be corrupted)';
        } else if (error.message.includes('Invalid')) {
            errorMessage += ' (invalid file format)';
        } else if (error.message.includes('All compression methods')) {
            errorMessage += ' (multiple compression attempts failed)';
        } else if (error.message.includes('fallback')) {
            errorMessage += ' (compression library error)';
        } else {
            errorMessage += ` (${error.message})`;
        }
        
        showNotification(errorMessage, 'error');
        
        // Add retry button to queue item
        addRetryButton(item.id);
    }
}

function updateQueueItemStatus(itemId, status, progress) {
    const statusElement = document.getElementById(`status-${itemId}`);
    const progressElement = document.getElementById(`progress-${itemId}`);
    
    if (statusElement) {
        statusElement.className = `file-status ${status}`;
        statusElement.innerHTML = 
            status === 'pending' ? '<i class="fas fa-clock"></i>' : 
            status === 'processing' ? '<i class="fas fa-spinner fa-spin"></i>' :
            status === 'completed' ? '<i class="fas fa-check"></i>' :
            '<i class="fas fa-times"></i>';
    }
    
    if (progressElement) {
        progressElement.style.width = `${progress}%`;
    }
}

// Image Compression
function compressImage(file, quality) {
    return new Promise((resolve, reject) => {
        console.log('=== Starting Primary Compression ===');
        console.log('File:', file.name, 'Size:', file.size, 'Type:', file.type, 'Quality:', quality);
        
        // Very simple options first
        const compressionOptions = {
            quality: quality,
            mimeType: 'image/jpeg',
            success: (result) => {
                console.log('✅ Primary compression successful!');
                console.log('Original size:', file.size, 'Compressed size:', result.size);
                console.log('Compression ratio:', ((file.size - result.size) / file.size * 100).toFixed(1) + '%');
                resolve(result);
            },
            error: (error) => {
                console.error('❌ Primary compression failed:');
                console.error('Error type:', error.constructor.name);
                console.error('Error message:', error.message);
                console.error('Error details:', error);
                reject(error);
            }
        };
        
        console.log('Using compression options:', compressionOptions);
        
        try {
            console.log('Initializing Compressor...');
            new Compressor(file, compressionOptions);
        } catch (error) {
            console.error('❌ Compressor initialization failed:', error);
            reject(error);
        }
    });
}

// Fallback compression with minimal options
function compressFallback(file, quality) {
    return new Promise((resolve, reject) => {
        console.log('=== Starting Fallback Compression ===');
        console.log('File:', file.name);
        
        // Minimal options
        const fallbackOptions = {
            quality: 0.8, // Fixed quality for fallback
            success: (result) => {
                console.log('✅ Fallback compression successful!');
                console.log('Original size:', file.size, 'Compressed size:', result.size);
                resolve(result);
            },
            error: (error) => {
                console.error('❌ Fallback compression failed:');
                console.error('Error:', error);
                reject(error);
            }
        };
        
        try {
            console.log('Initializing fallback Compressor...');
            new Compressor(file, fallbackOptions);
        } catch (error) {
            console.error('❌ Fallback compressor initialization failed:', error);
            reject(error);
        }
    });
}

// Canvas-based compression (standalone, no external library needed)
function compressWithCanvas(file, quality) {
    return new Promise((resolve, reject) => {
        console.log('=== Starting Canvas Compression ===');
        console.log('File:', file.name, 'Size:', formatFileSize(file.size));
        
        const img = new Image();
        img.onload = function() {
            try {
                console.log('Image loaded. Original dimensions:', img.width, 'x', img.height);
                
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Calculate optimal dimensions based on file size
                let { width, height } = calculateOptimalDimensions(img.width, img.height, file.size);
                
                canvas.width = width;
                canvas.height = height;
                
                console.log('Canvas dimensions:', width, 'x', height);
                
                // Enable image smoothing for better quality
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                
                // Draw image with high quality
                ctx.drawImage(img, 0, 0, width, height);
                console.log('Image drawn to canvas');
                
                // Clean up object URL
                URL.revokeObjectURL(img.src);
                
                // Convert to blob with specified quality
                canvas.toBlob((blob) => {
                    if (blob) {
                        const originalSize = file.size;
                        const compressedSize = blob.size;
                        const savings = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
                        
                        console.log('✅ Canvas compression successful!');
                        console.log('Original:', formatFileSize(originalSize));
                        console.log('Compressed:', formatFileSize(compressedSize));
                        console.log('Savings:', savings + '%');
                        
                        resolve(blob);
                    } else {
                        console.error('❌ Canvas toBlob returned null');
                        reject(new Error('Canvas compression failed to create blob'));
                    }
                }, 'image/jpeg', quality);
                
            } catch (error) {
                console.error('❌ Canvas compression error:', error);
                reject(error);
            }
        };
        
        img.onerror = function(e) {
            console.error('❌ Failed to load image for canvas compression:', e);
            console.log('Trying alternative loading method...');
            
            // Try without CORS
            const img2 = new Image();
            img2.onload = function() {
                console.log('✅ Alternative image loading successful');
                // Use the same compression logic
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    let { width, height } = calculateOptimalDimensions(img2.width, img2.height, file.size);
                    canvas.width = width;
                    canvas.height = height;
                    
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                    ctx.drawImage(img2, 0, 0, width, height);
                    
                    canvas.toBlob((blob) => {
                        URL.revokeObjectURL(img2.src);
                        if (blob) {
                            console.log('✅ Alternative canvas compression successful!');
                            resolve(blob);
                        } else {
                            reject(new Error('Alternative canvas compression also failed'));
                        }
                    }, 'image/jpeg', quality);
                    
                } catch (altError) {
                    reject(new Error('Alternative canvas compression failed: ' + altError.message));
                }
            };
            
            img2.onerror = function() {
                reject(new Error('All image loading methods failed for canvas compression'));
            };
            
            // Try loading without CORS
            const altObjectUrl = URL.createObjectURL(file);
            img2.src = altObjectUrl;
        };
        
        // Load image with CORS support first
        img.crossOrigin = 'anonymous';
        const objectUrl = URL.createObjectURL(file);
        console.log('Loading image...');
        img.src = objectUrl;
    });
}

// Calculate optimal dimensions for compression
function calculateOptimalDimensions(originalWidth, originalHeight, fileSize) {
    let width = originalWidth;
    let height = originalHeight;
    
    // Scale down large images for better compression
    if (fileSize > 5 * 1024 * 1024) { // > 5MB
        const maxDimension = 1920;
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        if (ratio < 1) {
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
        }
    } else if (fileSize > 2 * 1024 * 1024) { // > 2MB
        const maxDimension = 2048;
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        if (ratio < 1) {
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
        }
    }
    // Keep original dimensions for smaller files
    
    console.log('Dimension calculation:', {
        original: `${originalWidth}x${originalHeight}`,
        optimized: `${width}x${height}`,
        fileSize: formatFileSize(fileSize)
    });
    
    return { width, height };
}

// Direct file processing fallback (for severely problematic files)
function compressWithDirectProcessing(file, quality) {
    return new Promise((resolve, reject) => {
        console.log('=== Starting Direct File Processing ===');
        console.log('File:', file.name, 'Size:', formatFileSize(file.size));
        console.log('Attempting data URL method as last resort...');
        
        const reader = new FileReader();
        
        reader.onload = function(e) {
            try {
                const img = new Image();
                
                img.onload = function() {
                    try {
                        console.log('✅ Data URL image loading successful!');
                        console.log('Dimensions:', img.width, 'x', img.height);
                        
                        const canvas = document.createElement('canvas');
                        const ctx = canvas.getContext('2d');
                        
                        // Use smaller dimensions for problematic files
                        const maxSize = 800;
                        let { width, height } = img.width > maxSize || img.height > maxSize ? 
                            { width: Math.min(img.width, maxSize), height: Math.min(img.height, maxSize) } :
                            { width: img.width, height: img.height };
                        
                        // Maintain aspect ratio
                        if (img.width > img.height) {
                            height = (height * img.height) / img.width;
                        } else {
                            width = (width * img.width) / img.height;
                        }
                        
                        canvas.width = width;
                        canvas.height = height;
                        
                        ctx.drawImage(img, 0, 0, width, height);
                        
                        // Use lower quality for problematic files
                        const safeQuality = Math.min(quality, 0.6);
                        
                        canvas.toBlob((blob) => {
                            if (blob) {
                                const originalSize = file.size;
                                const processedSize = blob.size;
                                const savings = ((originalSize - processedSize) / originalSize * 100).toFixed(1);
                                
                                console.log('✅ Direct processing successful!');
                                console.log('Original:', formatFileSize(originalSize));
                                console.log('Processed:', formatFileSize(processedSize));
                                console.log('Savings:', savings + '%');
                                
                                resolve(blob);
                            } else {
                                reject(new Error('Data URL canvas compression failed'));
                            }
                        }, 'image/jpeg', safeQuality);
                        
                    } catch (canvasError) {
                        console.error('Data URL canvas processing failed:', canvasError);
                        reject(new Error('Data URL canvas processing failed: ' + canvasError.message));
                    }
                };
                
                img.onerror = function() {
                    console.error('Data URL image loading failed');
                    reject(new Error('Data URL image loading failed - file may be severely corrupted'));
                };
                
                // Load using data URL
                img.src = e.target.result;
                
            } catch (error) {
                console.error('Data URL processing error:', error);
                reject(new Error('Data URL processing failed: ' + error.message));
            }
        };
        
        reader.onerror = function() {
            console.error('FileReader failed to read file');
            reject(new Error('FileReader failed to read file'));
        };
        
        // Read file as data URL
        reader.readAsDataURL(file);
    });
}

// Results Display
function showResults() {
    if (compressedFiles.length === 0) return;
    
    resultsSection.style.display = 'block';
    resultsGrid.innerHTML = '';
    
    compressedFiles.forEach(item => {
        const resultElement = createResultElement(item);
        resultsGrid.appendChild(resultElement);
    });
    
    resultsSection.scrollIntoView({ behavior: 'smooth' });
    
    // Show ads after results are displayed
    showAdsAfterCompression();
}

function createResultElement(item) {
    const savings = ((item.originalSize - item.compressedSize) / item.originalSize * 100).toFixed(1);
    
    const div = document.createElement('div');
    div.className = 'result-item';
    
    div.innerHTML = `
        <div class="result-header">
            <div class="result-filename">${item.file.name}</div>
            <div class="result-stats">
                <span>Original: ${formatFileSize(item.originalSize)}</span>
                <span>Compressed: ${formatFileSize(item.compressedSize)}</span>
                <span style="color: #10b981; font-weight: bold;">${savings}% smaller</span>
            </div>
        </div>
        <div class="image-comparison">
            <div class="image-container">
                <div class="image-label">Original</div>
                <img src="${URL.createObjectURL(item.file)}" alt="Original" />
                <div class="image-size">${formatFileSize(item.originalSize)}</div>
            </div>
            <div class="image-container">
                <div class="image-label">Compressed</div>
                <img src="${URL.createObjectURL(item.compressedBlob)}" alt="Compressed" />
                <div class="image-size">${formatFileSize(item.compressedSize)}</div>
            </div>
        </div>
        <div class="result-actions">
            <div class="comparison-tools">
                <button class="tool-btn" onclick="compareImages('${item.id}')">
                    <i class="fas fa-eye"></i> Compare
                </button>
                <button class="tool-btn" onclick="toggleImages('${item.id}')">
                    <i class="fas fa-exchange-alt"></i> Toggle
                </button>
            </div>
            <button class="btn-primary" onclick="downloadImage('${item.id}')">
                <i class="fas fa-download"></i> Download
            </button>
        </div>
    `;
    
    return div;
}

// Download Functionality
function downloadImage(itemId) {
    const item = compressedFiles.find(f => f.id == itemId);
    if (!item) return;
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(item.compressedBlob);
    link.download = `compressed_${item.file.name}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification('Image downloaded successfully!', 'success');
}

// Quality Controls
function updateQualityValue() {
    qualityValue.textContent = `${qualitySlider.value}%`;
}

function setQualityPreset(button) {
    presetButtons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    
    const quality = button.getAttribute('data-quality');
    qualitySlider.value = quality;
    updateQualityValue();
}

// Utility Functions
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showProcessingSection() {
    processingSection.style.display = 'block';
}

function clearQueue() {
    compressionQueue = [];
    compressedFiles = [];
    isProcessing = false;
    updateQueueDisplay();
    processingSection.style.display = 'none';
    resultsSection.style.display = 'none';
    fileInput.value = '';
    
    // Remove any premium limitation messages
    const limitations = document.querySelectorAll('.premium-limitation');
    limitations.forEach(limitation => limitation.remove());
    
    showNotification('Queue cleared successfully', 'info');
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        font-weight: 600;
        z-index: 3000;
        animation: slideIn 0.3s ease;
        max-width: 400px;
    `;
    
    // Set background color based on type
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#2563eb'
    };
    
    notification.style.backgroundColor = colors[type] || colors.info;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Make functions globally available
window.currentUser = null;
window.openLoginModal = openLoginModal;
window.showUserMenu = showUserMenu;
window.toggleAuthMode = toggleAuthMode;

// Debug functions
window.checkRegisteredUsers = function() {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    console.log('Registered users:', users);
    return users;
};

window.clearAllUsers = function() {
    localStorage.removeItem('registeredUsers');
    localStorage.removeItem('currentUser');
    window.currentUser = null;
    currentUser = null;
    updateAuthUI();
    console.log('All user data cleared');
};


// Authentication System
function openLoginModal(isRegister = true) {
    console.log('Opening login modal, register mode:', isRegister);
    
    // Check if modal elements exist
    const loginModal = document.getElementById('loginModal');
    const modalTitle = document.getElementById('modalTitle');
    const authSubmitBtn = document.getElementById('authSubmitBtn');
    const authSwitchText = document.getElementById('authSwitchText');
    const nameFields = document.getElementById('nameFields');
    const confirmPasswordField = document.getElementById('confirmPasswordField');
    
    console.log('Modal elements check:', {
        loginModal: !!loginModal,
        modalTitle: !!modalTitle,
        authSubmitBtn: !!authSubmitBtn,
        authSwitchText: !!authSwitchText,
        nameFields: !!nameFields,
        confirmPasswordField: !!confirmPasswordField
    });
    
    if (!loginModal) {
        console.error('Login modal not found!');
        return;
    }
    
    if (isRegister) {
        modalTitle.textContent = 'Create an Account';
        authSubmitBtn.textContent = 'Create Account';
        authSwitchText.innerHTML = 'Already have an account? <a href="#" onclick="toggleAuthMode()">Log in</a>';
        nameFields.style.display = 'block';
        confirmPasswordField.style.display = 'block';
        
        // Make name fields required for registration
        document.getElementById('firstName').required = true;
        document.getElementById('lastName').required = true;
        document.getElementById('confirmPassword').required = true;
    } else {
        modalTitle.textContent = 'Log In';
        authSubmitBtn.textContent = 'Log In';
        authSwitchText.innerHTML = 'Don\'t have an account? <a href="#" onclick="toggleAuthMode()">Sign up</a>';
        nameFields.style.display = 'none';
        confirmPasswordField.style.display = 'none';
        
        // Remove required attribute for login mode
        document.getElementById('firstName').required = false;
        document.getElementById('lastName').required = false;
        document.getElementById('confirmPassword').required = false;
    }
    
    // Clear form before showing
    const form = document.getElementById('authForm');
    if (form) {
        form.reset();
    }
    
    console.log('Showing login modal');
    loginModal.style.display = 'flex';
}

function closeModal() {
    loginModal.style.display = 'none';
}

function toggleAuthMode() {
    const modalTitle = document.getElementById('modalTitle');
    const isCurrentlyRegister = modalTitle.textContent === 'Create an Account';
    openLoginModal(!isCurrentlyRegister);
}

function handleAuthentication(e) {
    e.preventDefault();
    console.log('Form submitted');
    
    const formData = new FormData(authForm);
    const modalTitle = document.getElementById('modalTitle');
    const isRegister = modalTitle.textContent === 'Create an Account';
    
    console.log('Form submission details:', {
        isRegister: isRegister,
        modalTitle: modalTitle.textContent,
        formData: Object.fromEntries(formData)
    });
    
    if (isRegister) {
        // Registration logic
        const email = formData.get('email');
        const password = formData.get('password');
        const confirmPassword = formData.get('confirmPassword');
        
        if (password !== confirmPassword) {
            showNotification('Passwords do not match', 'error');
            return;
        }
        
        // Check if user already exists
        const existingUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
        const userExists = existingUsers.find(user => user.email === email);
        
        if (userExists) {
            showNotification('An account with this email already exists. Please login instead.', 'error');
            return;
        }
        
        // Create new user
        const userData = {
            firstName: formData.get('firstName'),
            lastName: formData.get('lastName'),
            email: email,
            password: password, // In real app, this would be hashed
            isPremium: false,
            registrationDate: new Date().toISOString()
        };
        
        // Save to registered users list (localStorage)
        existingUsers.push(userData);
        localStorage.setItem('registeredUsers', JSON.stringify(existingUsers));
        
        // ALSO try to save to MySQL database (safe - won't break if it fails)
        // Use non-blocking approach to avoid async issues
        if (window.safeAPI && window.safeAPI.available) {
            console.log('🔄 Attempting to save user to MySQL database...');
            window.safeAPI.register({
                firstName: userData.firstName,
                lastName: userData.lastName,
                email: userData.email,
                password: userData.password
            }).then(apiResult => {
                if (apiResult.success) {
                    console.log('✅ User also saved to MySQL database successfully');
                } else {
                    console.log('⚠️ MySQL save failed:', apiResult.error);
                }
            }).catch(error => {
                console.log('⚠️ MySQL integration error (using localStorage):', error.message);
            });
        } else {
            console.log('💾 MySQL not available, using localStorage only');
        }
        
        // Set as current user
        const currentUserData = { ...userData };
        delete currentUserData.password; // Don't store password in current session
        
        console.log('Saving new user data:', currentUserData);
        localStorage.setItem('currentUser', JSON.stringify(currentUserData));
        currentUser = currentUserData;
        window.currentUser = currentUserData;
        console.log('Current user set to:', currentUser);
        
        showNotification('Account created successfully!', 'success');
    } else {
        // Login logic
        const email = formData.get('email');
        const password = formData.get('password');
        
        console.log('Login attempt with email:', email);
        
        if (!email || !password) {
            showNotification('Please enter both email and password', 'error');
            return;
        }
        
        // HYBRID LOGIN: Try MySQL first, then fallback to localStorage
        let userData = null;
        let loginSource = 'localStorage';
        
        // First, try to login using MySQL API (non-blocking)
        if (window.safeAPI && window.safeAPI.available) {
            console.log('🔄 Attempting MySQL login...');
            window.safeAPI.login(email, password).then(apiResult => {
                if (apiResult.success) {
                    console.log('✅ MySQL login successful');
                    // Update user data if MySQL login succeeded
                    const mysqlUserData = {
                        firstName: apiResult.user.firstName,
                        lastName: apiResult.user.lastName,
                        email: apiResult.user.email,
                        isPremium: apiResult.user.isPremium,
                        registrationDate: new Date().toISOString()
                    };
                    localStorage.setItem('currentUser', JSON.stringify(mysqlUserData));
                    currentUser = mysqlUserData;
                    window.currentUser = mysqlUserData;
                    updateAuthUI();
                }
            }).catch(error => {
                console.log('⚠️ MySQL login failed:', error.message);
            });
        }
        
        // If MySQL login failed, try localStorage
        if (!userData) {
            console.log('🔄 Attempting localStorage login...');
            const existingUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
            const registeredUser = existingUsers.find(user => user.email === email);
            
            if (!registeredUser) {
                showNotification('No account found with this email. Please create an account first.', 'error');
                return;
            }
            
            // Check password
            if (registeredUser.password !== password) {
                showNotification('Incorrect password. Please try again.', 'error');
                return;
            }
            
            // localStorage login successful
            userData = {
                firstName: registeredUser.firstName,
                lastName: registeredUser.lastName,
                email: registeredUser.email,
                isPremium: registeredUser.isPremium,
                registrationDate: registeredUser.registrationDate
            };
            console.log('✅ localStorage login successful');
        }
        
        // Login successful from either source
        console.log(`Login successful for user: ${userData.firstName} (source: ${loginSource})`);
        localStorage.setItem('currentUser', JSON.stringify(userData));
        currentUser = userData;
        window.currentUser = userData;
        console.log('Current user set to:', currentUser);
        
        showNotification(`Welcome back, ${userData.firstName}!`, 'success');
    }
    
    updateAuthUI();
    closeModal();
    authForm.reset();
}

function checkUserAuthentication() {
    console.log('Checking user authentication...');
    const savedUser = localStorage.getItem('currentUser');
    console.log('Saved user data:', savedUser);
    
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            window.currentUser = currentUser;
            console.log('Loaded user:', currentUser);
        } catch (error) {
            console.error('Error parsing saved user data:', error);
            localStorage.removeItem('currentUser');
            currentUser = null;
            window.currentUser = null;
        }
    } else {
        console.log('No saved user found');
        currentUser = null;
        window.currentUser = null;
    }
    
    // Always call updateAuthUI to set up the proper event listeners
    updateAuthUI();
}

function updateAuthUI() {
    console.log('Updating auth UI, current user:', currentUser);
    const loginLink = document.querySelector('a[href="#login"]');
    const upgradeBtn = document.getElementById('upgradeBtn');
    
    if (!loginLink) {
        console.error('Login link not found!');
        return;
    }
    
    // Simple approach - just update content and add onclick
    if (currentUser) {
        if (currentUser.isPremium) {
            loginLink.innerHTML = `
                <i class="fas fa-crown" style="color: #ffd700;"></i>
                <span style="margin-right: 5px;">${currentUser.firstName} (Premium)</span>
                <i class="fas fa-chevron-down" style="font-size: 10px; opacity: 0.7;"></i>
            `;
            if (upgradeBtn) upgradeBtn.style.display = 'none';
        } else {
            loginLink.innerHTML = `
                <i class="fas fa-user"></i>
                <span style="margin-right: 5px;">${currentUser.firstName}</span>
                <i class="fas fa-chevron-down" style="font-size: 10px; opacity: 0.7;"></i>
            `;
            if (upgradeBtn) upgradeBtn.style.display = 'inline-flex';
        }
        
        // Set up user menu
        loginLink.style.cursor = 'pointer';
        loginLink.style.transition = 'all 0.2s ease';
        loginLink.style.borderRadius = '6px';
        loginLink.style.padding = '8px 12px';
        
        loginLink.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            console.log('User menu clicked');
            showUserMenu(e);
            return false;
        };
        
        loginLink.onmouseenter = () => {
            loginLink.style.backgroundColor = 'rgba(37, 99, 235, 0.1)';
        };
        loginLink.onmouseleave = () => {
            loginLink.style.backgroundColor = 'transparent';
        };
        
    } else {
        loginLink.innerHTML = `
            <i class="fas fa-sign-in-alt"></i>
            <span>Login</span>
        `;
        loginLink.style.cursor = 'pointer';
        loginLink.style.padding = '8px 12px';
        if (upgradeBtn) upgradeBtn.style.display = 'none';
        
        // Set up login modal
        console.log('Setting up login modal click handler');
        loginLink.onclick = function(e) {
            e.preventDefault();
            console.log('Login link clicked from updateAuthUI, opening LOGIN modal');
            openLoginModal(false); // false = login mode, not register mode
            return false;
        };
    }
}

function showUserMenu(event) {
    // Remove any existing user menu
    const existingMenu = document.getElementById('userDropdownMenu');
    if (existingMenu) {
        existingMenu.remove();
        return; // If menu exists, just close it
    }

    // Get the clicked element's position
    const loginLink = event.target.closest('a');
    const rect = loginLink.getBoundingClientRect();
    
    // Create dropdown menu
    const menu = document.createElement('div');
    menu.id = 'userDropdownMenu';
    menu.style.cssText = `
        position: fixed;
        top: ${rect.bottom + 8}px;
        right: ${window.innerWidth - rect.right}px;
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        box-shadow: 0 8px 25px rgba(0,0,0,0.15);
        z-index: 9999;
        min-width: 220px;
        padding: 12px 0;
        animation: slideDown 0.2s ease;
    `;
    
    // Add CSS animation
    if (!document.getElementById('dropdownStyles')) {
        const style = document.createElement('style');
        style.id = 'dropdownStyles';
        style.textContent = `
            @keyframes slideDown {
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
        `;
        document.head.appendChild(style);
    }

    const menuItems = [
        {
            icon: 'fas fa-user',
            text: `Hello, ${currentUser.firstName}!`,
            action: null,
            style: 'font-weight: bold; color: #2563eb; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 8px;'
        }
    ];

    if (currentUser.isPremium) {
        menuItems.push({
            icon: 'fas fa-crown',
            text: 'Premium Account',
            action: null,
            style: 'color: #ffd700; font-weight: 600;'
        });
    } else {
        menuItems.push({
            icon: 'fas fa-crown',
            text: 'Upgrade to Premium',
            action: () => {
                closeUserMenu();
                openPremiumModal();
            },
            style: 'color: #f59e0b;'
        });
    }

    menuItems.push({
        icon: 'fas fa-sign-out-alt',
        text: 'Logout',
        action: logout,
        style: 'color: #ef4444; border-top: 1px solid #e2e8f0; margin-top: 8px; padding-top: 8px;'
    });

    menuItems.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.style.cssText = `
            padding: 12px 16px;
            cursor: ${item.action ? 'pointer' : 'default'};
            display: flex;
            align-items: center;
            gap: 12px;
            transition: background-color 0.2s;
            ${item.style || ''}
        `;
        
        if (item.action) {
            menuItem.addEventListener('mouseenter', () => {
                menuItem.style.backgroundColor = '#f8fafc';
            });
            menuItem.addEventListener('mouseleave', () => {
                menuItem.style.backgroundColor = 'transparent';
            });
            menuItem.addEventListener('click', () => {
                item.action();
            });
        }

        menuItem.innerHTML = `
            <i class="${item.icon}"></i>
            <span>${item.text}</span>
        `;
        
        menu.appendChild(menuItem);
    });

    document.body.appendChild(menu);

    // Close menu when clicking outside
    setTimeout(() => {
        document.addEventListener('click', closeUserMenuOnOutsideClick, true);
    }, 100);
}

function closeUserMenuOnOutsideClick(event) {
    const menu = document.getElementById('userDropdownMenu');
    if (menu && !menu.contains(event.target)) {
        closeUserMenu();
    }
}

function closeUserMenu() {
    const menu = document.getElementById('userDropdownMenu');
    if (menu) {
        menu.remove();
    }
    document.removeEventListener('click', closeUserMenuOnOutsideClick, true);
}

function logout() {
    closeUserMenu();
    localStorage.removeItem('currentUser');
    currentUser = null;
    window.currentUser = null;
    updateAuthUI();
    showNotification('Logged out successfully', 'info');
}

// Image Comparison Functions
function compareImages(itemId) {
    // This would open a modal with side-by-side comparison
    showNotification('Comparison view coming soon!', 'info');
}

function toggleImages(itemId) {
    // This would toggle between original and compressed in the same container
    showNotification('Toggle view coming soon!', 'info');
}

// Retry functionality
function addRetryButton(itemId) {
    const retryContainer = document.getElementById(`retry-${itemId}`);
    if (retryContainer) {
        retryContainer.innerHTML = `
            <button class="retry-btn" onclick="retryCompression('${itemId}')">
                <i class="fas fa-redo"></i> Retry
            </button>
        `;
    }
}

async function retryCompression(itemId) {
    const item = compressionQueue.find(q => q.id == itemId);
    if (!item) return;
    
    // Reset item status
    item.status = 'pending';
    item.progress = 0;
    item.error = null;
    
    // Clear retry button
    const retryContainer = document.getElementById(`retry-${itemId}`);
    if (retryContainer) {
        retryContainer.innerHTML = '';
    }
    
    // Update display
    updateQueueItemStatus(itemId, 'pending', 0);
    
    // Process the item again
    await processQueueItem(item);
}

// Advertisement Management
function initializeAds() {
    console.log('Initializing Google AdSense');
    
    // Hide ads for premium users
    if (currentUser?.isPremium) {
        console.log('Premium user - hiding all ads');
        hideAllAds();
        return;
    }
    
    console.log('Free user - initializing ads');
    
    // Initialize AdSense
    initializeAdSense();
    
    // Show sidebar ad after user activity
    setTimeout(() => {
        if (compressionQueue.length > 0 && !currentUser?.isPremium) {
            showSidebarAd();
        }
    }, 10000); // Show after 10 seconds of activity
}

function showSidebarAd() {
    const sidebarAd = document.getElementById('sidebarAd');
    if (sidebarAd && window.innerWidth > 1400) {
        sidebarAd.style.display = 'block';
        
        // Auto-hide after 30 seconds
        setTimeout(() => {
            sidebarAd.style.display = 'none';
        }, 30000);
    }
}

function hideSidebarAd() {
    const sidebarAd = document.getElementById('sidebarAd');
    if (sidebarAd) {
        sidebarAd.style.display = 'none';
    }
}

// Initialize Google AdSense
function initializeAdSense() {
    // Check if AdSense script is already loaded
    if (window.adsbygoogle) {
        console.log('AdSense already initialized');
        return;
    }
    
    // Try to push ads
    try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        console.log('AdSense ads pushed');
    } catch (e) {
        console.log('AdSense not yet loaded, will retry');
        setTimeout(initializeAdSense, 1000);
    }
}

// Hide all ads (for premium users)
function hideAllAds() {
    const adElements = [
        document.getElementById('bannerAd'),
        document.getElementById('sidebarAd'),
        document.getElementById('resultsAd')
    ];
    
    adElements.forEach(ad => {
        if (ad) {
            ad.style.display = 'none';
        }
    });
    
    console.log('All ads hidden for premium user');
}

// Show ads for free users
function showAdsForFreeUsers() {
    if (currentUser?.isPremium) {
        hideAllAds();
        return;
    }
    
    // Show banner ad
    const bannerAd = document.getElementById('bannerAd');
    if (bannerAd) {
        bannerAd.style.display = 'block';
    }
    
    // Show results ad if results are visible
    const resultsSection = document.getElementById('resultsSection');
    const resultsAd = document.getElementById('resultsAd');
    if (resultsSection && resultsAd && resultsSection.style.display !== 'none') {
        resultsAd.style.display = 'block';
    }
}

// Show ads after compression completion
function showAdsAfterCompression() {
    if (currentUser?.isPremium) {
        return;
    }
    
    // Show results ad
    const resultsAd = document.getElementById('resultsAd');
    if (resultsAd) {
        resultsAd.style.display = 'block';
        
        // Push new ad
        try {
            (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch (e) {
            console.log('Error loading results ad:', e);
        }
    }
    
    // Scroll to advertisement section after results are shown
    setTimeout(() => {
        const adSection = document.querySelector('.advertisement-section');
        if (adSection && compressedFiles.length > 0) {
            adSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, 2000);
}

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    
    .sidebar-ad {
        animation: fadeIn 0.5s ease-in-out;
    }
`;
document.head.appendChild(style);

// Premium & Payment Management
function openPremiumModal() {
    const premiumModal = document.getElementById('premiumModal');
    premiumModal.style.display = 'flex';
}

function closePremiumModal() {
    const premiumModal = document.getElementById('premiumModal');
    premiumModal.style.display = 'none';
}


function showPremiumLimitation(message) {
    const limitation = document.createElement('div');
    limitation.className = 'premium-limitation';
    limitation.innerHTML = `
        <i class="fas fa-crown"></i>
        <span>${message}</span>
        <button class="upgrade-btn" onclick="openPremiumModal()">
            <i class="fas fa-crown"></i>
            Upgrade Now
        </button>
    `;
    
    // Insert after upload area
    const uploadSection = document.querySelector('.upload-section');
    uploadSection.appendChild(limitation);
    
    // Remove after 10 seconds
    setTimeout(() => {
        limitation.remove();
    }, 10000);
}

async function initializePayment(plan) {
    if (!currentUser) {
        showNotification('Please log in to upgrade to Premium', 'warning');
        closePremiumModal();
        openLoginModal(false);
        return;
    }
    
    // Show "Coming Soon" message with plan details
    const planDetails = {
        monthly: { name: 'Monthly Plan', price: '$9.99/month' },
        yearly: { name: 'Yearly Plan', price: '$99.99/year', savings: 'Save $19.89!' }
    };
    
    const selectedPlan = planDetails[plan];
    const message = selectedPlan.savings 
        ? `🚧 Payment Integration Coming Soon!\n\nSelected: ${selectedPlan.name}\nPrice: ${selectedPlan.price}\n${selectedPlan.savings}\n\nSecure payment processing will be available soon!`
        : `🚧 Payment Integration Coming Soon!\n\nSelected: ${selectedPlan.name}\nPrice: ${selectedPlan.price}\n\nSecure payment processing will be available soon!`;
    
    showNotification(message, 'info');
    
    // Close modal after a moment
    setTimeout(() => {
        closePremiumModal();
    }, 3000);
    
    console.log(`User ${currentUser.firstName} interested in ${plan} plan (${selectedPlan.price})`);
}

// Function to upgrade user to premium (for future use)
function upgradeUserToPremium(plan) {
    if (!currentUser) return;
    
    currentUser.isPremium = true;
    currentUser.subscriptionType = plan;
    currentUser.subscriptionDate = new Date().toISOString();
    window.currentUser = currentUser;
    
    // Update registered users list
    const existingUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const userIndex = existingUsers.findIndex(user => user.email === currentUser.email);
    if (userIndex !== -1) {
        existingUsers[userIndex].isPremium = true;
        existingUsers[userIndex].subscriptionType = plan;
        existingUsers[userIndex].subscriptionDate = currentUser.subscriptionDate;
        localStorage.setItem('registeredUsers', JSON.stringify(existingUsers));
    }
    
    // Save to localStorage
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    
    closePremiumModal();
    showNotification('🎉 Welcome to Premium! You now have unlimited access to all features.', 'success');
    updateAuthUI();
    hidePremiumLimitations();
    
    // Hide ads for premium users
    hideAllAds();
}

// Simulate backend API call to create checkout session
async function createCheckoutSession(plan) {
    // This would be a real API call to your backend
    // For demo purposes, we'll return a mock response
    return new Promise((resolve) => {
        setTimeout(() => {
            // Simulate successful session creation
            resolve({
                sessionId: null, // Set to null to trigger demo flow
                url: null
            });
        }, 1000);
    });
}

function simulateSuccessfulPayment(plan) {
    // Update user to premium status
    currentUser.isPremium = true;
    currentUser.subscriptionType = plan;
    currentUser.subscriptionDate = new Date().toISOString();
    
    // Save to localStorage (in real app, this would be handled by backend)
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    
    closePremiumModal();
    showNotification('🎉 Welcome to Premium! You now have unlimited access to all features.', 'success');
    updateAuthUI();
    hidePremiumLimitations();
}

function hidePremiumLimitations() {
    const limitations = document.querySelectorAll('.premium-limitation');
    limitations.forEach(limitation => limitation.remove());
}


// Update processFiles to check premium limits
function processFilesWithPremiumCheck(files) {
    console.log('Processing files with premium check:', files.length);
    
    if (!files || files.length === 0) {
        console.log('No files provided');
        showNotification('No files selected', 'error');
        return;
    }
    
    // Prevent multiple simultaneous processing
    if (window.processingFiles) {
        console.log('Already processing files, skipping...');
        return;
    }
    
    window.processingFiles = true;
    
    try {
        // Filter valid files first
        const validFiles = files.filter(file => {
            const isValid = validateFile(file);
            console.log(`File ${file.name} validation:`, isValid);
            return isValid;
        });
        
        console.log('Valid files:', validFiles.length);
        
        if (validFiles.length === 0) {
            showNotification('Please select valid JPEG files', 'error');
            return;
        }
        
        // Check if adding these files would exceed limits
        const currentQueueLength = compressionQueue.length;
        const maxFiles = currentUser?.isPremium ? 100 : 10;
        const totalAfterUpload = currentQueueLength + validFiles.length;
        
        console.log('Queue check:', {
            currentQueueLength,
            maxFiles,
            totalAfterUpload,
            isPremium: currentUser?.isPremium
        });
        
        if (totalAfterUpload > maxFiles && !currentUser?.isPremium) {
            const remainingSlots = maxFiles - currentQueueLength;
            if (remainingSlots <= 0) {
                showPremiumLimitation('Free users can upload maximum 10 files at once. Clear the queue or upgrade to Premium for unlimited uploads!');
                return;
            }
            
            showPremiumLimitation(`You can only upload ${remainingSlots} more file(s) with the free plan. Upgrade to Premium for unlimited uploads!`);
            validFiles.splice(remainingSlots);
        }
        
        if (validFiles.length > 0) {
            console.log('Adding files to queue:', validFiles.length);
            validFiles.forEach(file => addToQueue(file));
            startProcessing();
        }
    } finally {
        // Reset processing flag after a delay
        setTimeout(() => {
            window.processingFiles = false;
        }, 1000);
    }
}

// Premium feature indicators
function addPremiumBadges() {
    if (currentUser?.isPremium) {
        // Add premium badges to features
        const features = document.querySelectorAll('.feature-card');
        features.forEach(feature => {
            if (!feature.querySelector('.premium-badge')) {
                const badge = document.createElement('div');
                badge.className = 'premium-badge';
                badge.textContent = 'Premium';
                feature.appendChild(badge);
            }
        });
    }
}

// Initialize premium features on page load
function initializePremiumFeatures() {
    if (currentUser?.isPremium) {
        addPremiumBadges();
        hidePremiumLimitations();
        
        // Hide ads for premium users
        const adSections = document.querySelectorAll('.advertisement-section, .sidebar-ad');
        adSections.forEach(ad => ad.style.display = 'none');
    }
}