const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const archiver = require('archiver');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { optionalAuth, verifyToken, requirePremium } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Supported output formats and their MIME types
const FORMAT_CONFIG = {
    jpeg: { mime: 'image/jpeg', ext: '.jpg', label: 'JPEG', supportsAlpha: false },
    webp: { mime: 'image/webp', ext: '.webp', label: 'WebP', supportsAlpha: true },
    avif: { mime: 'image/avif', ext: '.avif', label: 'AVIF', supportsAlpha: true },
    png:  { mime: 'image/png',  ext: '.png', label: 'PNG', supportsAlpha: true },
    tiff: { mime: 'image/tiff', ext: '.tiff', label: 'TIFF', supportsAlpha: true },
    gif:  { mime: 'image/gif', ext: '.gif', label: 'GIF', supportsAlpha: true },
    heif: { mime: 'image/heif', ext: '.heif', label: 'HEIF', supportsAlpha: false }
};

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB max
        files: 50
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
            'image/heic', 'image/heif', 'image/tiff', 'image/gif',
            'image/bmp', 'image/svg+xml', 'image/avif',
            'image/x-icon', 'image/vnd.microsoft.icon',
            'application/pdf'
        ];
        // Also allow by file extension for formats where MIME detection is unreliable
        const ext = (file.originalname || '').toLowerCase().split('.').pop();
        const allowedExts = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tiff', 'tif',
                             'gif', 'bmp', 'svg', 'avif', 'ico', 'pdf', 'jfif', 'pjpeg', 'pjp'];
        if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported format: ${file.mimetype}. Supported: JPEG, PNG, WebP, HEIC, HEIF, TIFF, GIF, BMP, SVG, AVIF, ICO, PDF`), false);
        }
    }
});

// Middleware to check usage limits
const checkUsageLimits = async (req, res, next) => {
    try {
        const files = req.files || [];
        const isPremium = req.user?.is_premium || false;

        const settingsResult = await query(
            `SELECT setting_key, setting_value
             FROM admin_settings
             WHERE setting_key IN (
                'max_file_size_free_mb', 'max_file_size_premium_mb',
                'max_files_per_batch_free', 'max_files_per_batch_premium'
             )`
        );

        const settings = {};
        settingsResult.rows.forEach(row => {
            settings[row.setting_key] = parseInt(row.setting_value);
        });

        const maxFileSize = isPremium ?
            (settings.max_file_size_premium_mb || 100) :
            (settings.max_file_size_free_mb || 10);
        const maxFiles = isPremium ?
            (settings.max_files_per_batch_premium || 50) :
            (settings.max_files_per_batch_free || 5);

        if (files.length > maxFiles) {
            return res.status(413).json({
                error: 'Too many files',
                message: `${isPremium ? 'Premium' : 'Free'} users can upload up to ${maxFiles} files at once`,
                limits: { maxFiles, currentFiles: files.length, upgradeRequired: !isPremium }
            });
        }

        const maxFileSizeBytes = maxFileSize * 1024 * 1024;
        for (const file of files) {
            if (file.size > maxFileSizeBytes) {
                return res.status(413).json({
                    error: 'File too large',
                    message: `File "${file.originalname}" is ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: ${maxFileSize}MB`,
                    limits: { maxFileSizeMB: maxFileSize, fileSizeMB: (file.size / 1024 / 1024).toFixed(1), upgradeRequired: !isPremium }
                });
            }
        }

        next();
    } catch (error) {
        logger.error('Usage limits check error:', error);
        res.status(500).json({ error: 'Failed to check usage limits' });
    }
};

// Build Sharp compression pipeline for a given format
function applyOutputFormat(pipeline, format, quality, metadata) {
    switch (format) {
        case 'webp':
            return pipeline.webp({
                quality,
                effort: 4,
                smartSubsample: true,
                nearLossless: quality >= 90
            });
        case 'avif':
            return pipeline.avif({
                quality,
                effort: 4,
                chromaSubsampling: '4:2:0'
            });
        case 'png':
            return pipeline.png({
                compressionLevel: Math.round(9 - (quality / 100) * 9), // quality 100 = level 0, quality 1 = level 9
                progressive: true,
                adaptiveFiltering: true,
                palette: quality < 50 // Use palette for heavy compression
            });
        case 'tiff':
            return pipeline.tiff({
                quality,
                compression: 'deflate',
                predictor: 'horizontal'
            });
        case 'gif':
            return pipeline.gif({
                effort: 7,
                colours: quality >= 80 ? 256 : Math.max(2, Math.round(256 * (quality / 100)))
            });
        case 'heif':
            return pipeline.heif({
                quality,
                compression: 'av1'
            });
        case 'jpeg':
        default:
            return pipeline.jpeg({
                quality,
                progressive: true,
                mozjpeg: true,
                optimiseScans: true,
                chromaSubsampling: '4:2:0'
            });
    }
}

// POST /api/images/compress - Compress images with advanced options
router.post('/compress',
    optionalAuth,
    upload.array('images', 50),
    checkUsageLimits,
    async (req, res) => {
        try {
            const files = req.files || [];
            if (files.length === 0) {
                return res.status(400).json({ error: 'No files provided', message: 'Please select at least one image to compress' });
            }

            // Parse options from request body
            let quality = parseInt(req.body.quality) || 80;
            if (quality > 0 && quality < 1) quality = Math.round(quality * 100);
            quality = Math.max(1, Math.min(100, quality));

            const outputFormat = (req.body.format || 'jpeg').toLowerCase();
            if (!FORMAT_CONFIG[outputFormat]) {
                return res.status(400).json({ error: 'Invalid format', message: `Supported formats: ${Object.keys(FORMAT_CONFIG).join(', ')}` });
            }

            const stripMetadata = req.body.stripMetadata === 'true' || req.body.stripMetadata === true;
            const resizeWidth = parseInt(req.body.width) || null;
            const resizeHeight = parseInt(req.body.height) || null;
            const resizeScale = parseFloat(req.body.scale) || null; // e.g., 0.5 for 50%
            const maintainAspectRatio = req.body.maintainAspectRatio !== 'false';

            // Watermark options (premium only)
            const watermarkText = req.body.watermarkText || null;
            const watermarkPosition = req.body.watermarkPosition || 'southeast'; // northwest, northeast, southwest, southeast, center
            const watermarkOpacity = Math.min(1, Math.max(0.1, parseFloat(req.body.watermarkOpacity) || 0.3));

            // DPI and color profile options
            const dpi = parseInt(req.body.dpi) || null;
            const colorProfile = req.body.colorProfile || null;
            const targetSizeKB = parseInt(req.body.targetSizeKB) || null;

            const sessionId = req.body.sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const results = [];
            const startTime = Date.now();

            for (const file of files) {
                const fileStartTime = Date.now();
                let result = {
                    originalName: file.originalname,
                    originalSize: file.size,
                    originalSizeMB: (file.size / 1024 / 1024).toFixed(2),
                    success: false
                };

                try {
                    let pipeline = sharp(file.buffer, { failOn: 'none' });
                    const metadata = await pipeline.metadata();

                    logger.info(`Processing: ${file.originalname} | ${metadata.format} ${metadata.width}x${metadata.height} | -> ${outputFormat} q${quality}${dpi ? ` ${dpi}dpi` : ''}${colorProfile ? ` ${colorProfile}` : ''}`);

                    // Resize if requested
                    let targetWidth = metadata.width;
                    let targetHeight = metadata.height;

                    if (resizeScale && resizeScale > 0 && resizeScale < 1) {
                        targetWidth = Math.round(metadata.width * resizeScale);
                        targetHeight = Math.round(metadata.height * resizeScale);
                        pipeline = pipeline.resize(targetWidth, targetHeight, { fit: 'fill' });
                    } else if (resizeWidth || resizeHeight) {
                        const resizeOpts = {
                            fit: maintainAspectRatio ? 'inside' : 'fill',
                            withoutEnlargement: true
                        };
                        if (resizeWidth) resizeOpts.width = resizeWidth;
                        if (resizeHeight) resizeOpts.height = resizeHeight;
                        pipeline = pipeline.resize(resizeOpts);
                    }

                    // Apply color space conversion if requested
                    if (colorProfile === 'srgb') {
                        pipeline = pipeline.toColorspace('srgb');
                    } else if (colorProfile === 'p3') {
                        pipeline = pipeline.toColorspace('rgb16'); // Wide gamut approximation
                    } else if (colorProfile === 'cmyk') {
                        pipeline = pipeline.toColorspace('cmyk');
                    }

                    // Strip metadata if requested (removes EXIF, IPTC, XMP)
                    if (stripMetadata) {
                        pipeline = pipeline.withMetadata(dpi ? { density: dpi } : {}); // Strips metadata but sets DPI if requested
                    } else if (dpi) {
                        // Preserve metadata but override DPI
                        pipeline = pipeline.withMetadata({ density: dpi });
                    } else {
                        // Preserve orientation but allow other metadata through
                        pipeline = pipeline.rotate(); // Auto-rotate based on EXIF
                    }

                    // Flatten transparency for non-alpha formats
                    if (metadata.hasAlpha && !FORMAT_CONFIG[outputFormat]?.supportsAlpha) {
                        pipeline = pipeline.flatten({ background: '#FFFFFF' });
                    }

                    // Apply watermark (premium only)
                    if (watermarkText && req.user?.is_premium) {
                        const watermarkSvg = createWatermarkSvg(watermarkText, targetWidth || metadata.width, targetHeight || metadata.height, watermarkOpacity);
                        pipeline = pipeline.composite([{
                            input: Buffer.from(watermarkSvg),
                            gravity: watermarkPosition
                        }]);
                    }

                    // Apply output format compression (with optional target size)
                    let compressedBuffer;
                    let finalQuality = quality;

                    if (targetSizeKB && ['jpeg', 'webp', 'avif', 'heif'].includes(outputFormat)) {
                        // Binary search for quality that hits target file size
                        const targetBytes = targetSizeKB * 1024;
                        let low = 5, high = quality, bestBuffer = null;

                        // Helper to compress at a given quality from the original buffer
                        const compressAtQuality = async (q) => {
                            let p = sharp(file.buffer, { failOn: 'none' });
                            if (resizeScale && resizeScale > 0 && resizeScale < 1) {
                                p = p.resize(Math.round(metadata.width * resizeScale), Math.round(metadata.height * resizeScale), { fit: 'fill' });
                            } else if (resizeWidth || resizeHeight) {
                                const rOpts = { fit: maintainAspectRatio ? 'inside' : 'fill', withoutEnlargement: true };
                                if (resizeWidth) rOpts.width = resizeWidth;
                                if (resizeHeight) rOpts.height = resizeHeight;
                                p = p.resize(rOpts);
                            }
                            if (metadata.hasAlpha && !FORMAT_CONFIG[outputFormat]?.supportsAlpha) {
                                p = p.flatten({ background: '#FFFFFF' });
                            }
                            p = applyOutputFormat(p, outputFormat, q, metadata);
                            return p.toBuffer();
                        };

                        // First try with requested quality
                        const firstTry = await compressAtQuality(quality);
                        if (firstTry.length <= targetBytes) {
                            compressedBuffer = firstTry;
                            finalQuality = quality;
                        } else {
                            // Binary search for optimal quality
                            for (let i = 0; i < 6; i++) {
                                const mid = Math.round((low + high) / 2);
                                const testBuf = await compressAtQuality(mid);
                                if (testBuf.length <= targetBytes) {
                                    bestBuffer = testBuf;
                                    finalQuality = mid;
                                    low = mid + 1;
                                } else {
                                    high = mid - 1;
                                }
                            }
                            if (bestBuffer) {
                                compressedBuffer = bestBuffer;
                            } else {
                                // Even lowest quality exceeds target - use lowest quality result
                                compressedBuffer = await compressAtQuality(5);
                                finalQuality = 5;
                            }
                        }
                        logger.info(`Target size: ${targetSizeKB}KB | Final quality: ${finalQuality} | Result: ${(compressedBuffer.length / 1024).toFixed(0)}KB`);
                    } else {
                        pipeline = applyOutputFormat(pipeline, outputFormat, quality, metadata);
                        compressedBuffer = await pipeline.toBuffer();
                    }

                    const compressionRatio = ((file.size - compressedBuffer.length) / file.size * 100);
                    const processingTime = Date.now() - fileStartTime;

                    // Generate output filename
                    const nameWithoutExt = file.originalname.replace(/\.[^/.]+$/, '');
                    const outputFilename = `${nameWithoutExt}_compressed${FORMAT_CONFIG[outputFormat].ext}`;

                    result = {
                        ...result,
                        outputFilename,
                        compressedSize: compressedBuffer.length,
                        compressedSizeMB: (compressedBuffer.length / 1024 / 1024).toFixed(2),
                        compressionRatio: compressionRatio.toFixed(1),
                        savingsBytes: file.size - compressedBuffer.length,
                        savingsMB: ((file.size - compressedBuffer.length) / 1024 / 1024).toFixed(2),
                        processingTimeMs: processingTime,
                        compressedData: compressedBuffer.toString('base64'),
                        mimeType: FORMAT_CONFIG[outputFormat].mime,
                        outputFormat,
                        qualityUsed: finalQuality,
                        targetSizeKB: targetSizeKB || null,
                        dimensions: {
                            original: { width: metadata.width, height: metadata.height },
                            output: { width: targetWidth, height: targetHeight }
                        },
                        success: true
                    };

                    // Log to database
                    try {
                        await query(
                            `INSERT INTO image_processing_logs
                             (user_id, session_id, original_filename, original_size_bytes,
                              compressed_size_bytes, compression_ratio, quality_setting,
                              processing_time_ms, compression_method, user_agent, ip_address)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                            [
                                req.user?.id || null,
                                sessionId,
                                file.originalname,
                                file.size,
                                compressedBuffer.length,
                                compressionRatio,
                                quality,
                                processingTime,
                                `sharp_${outputFormat}`,
                                req.get('User-Agent'),
                                req.ip
                            ]
                        );

                        if (req.user?.id) {
                            const originalMB = file.size / 1024 / 1024;
                            const compressedMB = compressedBuffer.length / 1024 / 1024;
                            const savingsMB = (file.size - compressedBuffer.length) / 1024 / 1024;
                            await query(
                                `INSERT INTO usage_statistics
                                 (user_id, date, images_processed, total_original_size_mb,
                                  total_compressed_size_mb, total_savings_mb)
                                 VALUES (?, CURDATE(), 1, ?, ?, ?)
                                 ON DUPLICATE KEY UPDATE
                                    images_processed = images_processed + 1,
                                    total_original_size_mb = total_original_size_mb + VALUES(total_original_size_mb),
                                    total_compressed_size_mb = total_compressed_size_mb + VALUES(total_compressed_size_mb),
                                    total_savings_mb = total_savings_mb + VALUES(total_savings_mb)`,
                                [req.user.id, originalMB, compressedMB, savingsMB]
                            );
                        }
                    } catch (dbErr) {
                        logger.error('DB logging failed (non-critical):', dbErr.message);
                    }

                } catch (compressionError) {
                    logger.error(`Compression failed for ${file.originalname}:`, compressionError);
                    result.error = 'Compression failed';
                    result.errorMessage = compressionError.message || 'Unable to compress this image.';
                }

                results.push(result);
            }

            const totalProcessingTime = Date.now() - startTime;
            const successfulCompressions = results.filter(r => r.success).length;
            const totalOriginalSize = results.reduce((sum, r) => sum + r.originalSize, 0);
            const totalCompressedSize = results.reduce((sum, r) => sum + (r.compressedSize || 0), 0);
            const overallCompressionRatio = totalOriginalSize > 0 ?
                ((totalOriginalSize - totalCompressedSize) / totalOriginalSize * 100).toFixed(1) : '0';

            logger.info(`Compressed ${successfulCompressions}/${files.length} images for ${req.user?.email || 'anonymous'} in ${totalProcessingTime}ms | format=${outputFormat}`);

            res.json({
                results,
                summary: {
                    totalFiles: files.length,
                    successfulCompressions,
                    failedCompressions: files.length - successfulCompressions,
                    totalOriginalSizeMB: (totalOriginalSize / 1024 / 1024).toFixed(2),
                    totalCompressedSizeMB: (totalCompressedSize / 1024 / 1024).toFixed(2),
                    totalSavingsMB: ((totalOriginalSize - totalCompressedSize) / 1024 / 1024).toFixed(2),
                    overallCompressionRatio,
                    processingTimeMs: totalProcessingTime,
                    quality,
                    outputFormat
                },
                sessionId
            });

        } catch (error) {
            logger.error('Image compression error:', error);
            res.status(500).json({ error: 'Compression failed', message: 'Internal server error during image compression' });
        }
    }
);

// POST /api/images/compress-zip - Compress images and return as ZIP
router.post('/compress-zip',
    optionalAuth,
    upload.array('images', 50),
    checkUsageLimits,
    async (req, res) => {
        try {
            const files = req.files || [];
            if (files.length === 0) {
                return res.status(400).json({ error: 'No files provided' });
            }

            let quality = parseInt(req.body.quality) || 80;
            quality = Math.max(1, Math.min(100, quality));
            const outputFormat = (req.body.format || 'jpeg').toLowerCase();
            if (!FORMAT_CONFIG[outputFormat]) {
                return res.status(400).json({ error: 'Invalid format' });
            }
            const stripMetadata = req.body.stripMetadata === 'true' || req.body.stripMetadata === true;
            const resizeWidth = parseInt(req.body.width) || null;
            const resizeHeight = parseInt(req.body.height) || null;
            const resizeScale = parseFloat(req.body.scale) || null;
            const dpi = parseInt(req.body.dpi) || null;
            const colorProfile = req.body.colorProfile || null;
            const targetSizeKB = parseInt(req.body.targetSizeKB) || null;

            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="compressed_images.zip"');

            const archive = archiver('zip', { zlib: { level: 1 } }); // Low ZIP compression since images are already compressed
            archive.pipe(res);

            let processed = 0;
            for (const file of files) {
                try {
                    let pipeline = sharp(file.buffer, { failOn: 'none' });
                    const metadata = await pipeline.metadata();

                    if (resizeScale && resizeScale > 0 && resizeScale < 1) {
                        pipeline = pipeline.resize(
                            Math.round(metadata.width * resizeScale),
                            Math.round(metadata.height * resizeScale),
                            { fit: 'fill' }
                        );
                    } else if (resizeWidth || resizeHeight) {
                        const resizeOpts = { fit: 'inside', withoutEnlargement: true };
                        if (resizeWidth) resizeOpts.width = resizeWidth;
                        if (resizeHeight) resizeOpts.height = resizeHeight;
                        pipeline = pipeline.resize(resizeOpts);
                    }

                    // Apply color space conversion
                    if (colorProfile === 'srgb') {
                        pipeline = pipeline.toColorspace('srgb');
                    } else if (colorProfile === 'p3') {
                        pipeline = pipeline.toColorspace('rgb16');
                    } else if (colorProfile === 'cmyk') {
                        pipeline = pipeline.toColorspace('cmyk');
                    }

                    if (stripMetadata) {
                        pipeline = pipeline.withMetadata(dpi ? { density: dpi } : {});
                    } else if (dpi) {
                        pipeline = pipeline.withMetadata({ density: dpi });
                    } else {
                        pipeline = pipeline.rotate();
                    }

                    if (metadata.hasAlpha && !FORMAT_CONFIG[outputFormat]?.supportsAlpha) {
                        pipeline = pipeline.flatten({ background: '#FFFFFF' });
                    }

                    let compressedBuffer;
                    if (targetSizeKB && ['jpeg', 'webp', 'avif', 'heif'].includes(outputFormat)) {
                        const targetBytes = targetSizeKB * 1024;
                        let low = 5, high = quality, bestBuf = null, bestQ = quality;
                        const tryQ = async (q) => {
                            let p = sharp(file.buffer, { failOn: 'none' });
                            if (resizeScale && resizeScale > 0 && resizeScale < 1) p = p.resize(Math.round(metadata.width * resizeScale), Math.round(metadata.height * resizeScale), { fit: 'fill' });
                            if (metadata.hasAlpha && !FORMAT_CONFIG[outputFormat]?.supportsAlpha) p = p.flatten({ background: '#FFFFFF' });
                            return applyOutputFormat(p, outputFormat, q, metadata).toBuffer();
                        };
                        const first = await tryQ(quality);
                        if (first.length <= targetBytes) { compressedBuffer = first; }
                        else {
                            for (let i = 0; i < 6; i++) {
                                const mid = Math.round((low + high) / 2);
                                const buf = await tryQ(mid);
                                if (buf.length <= targetBytes) { bestBuf = buf; bestQ = mid; low = mid + 1; }
                                else { high = mid - 1; }
                            }
                            compressedBuffer = bestBuf || await tryQ(5);
                        }
                    } else {
                        pipeline = applyOutputFormat(pipeline, outputFormat, quality, metadata);
                        compressedBuffer = await pipeline.toBuffer();
                    }

                    const nameWithoutExt = file.originalname.replace(/\.[^/.]+$/, '');
                    const outputFilename = `${nameWithoutExt}${FORMAT_CONFIG[outputFormat].ext}`;
                    archive.append(compressedBuffer, { name: outputFilename });
                    processed++;
                } catch (err) {
                    logger.error(`ZIP: Failed to compress ${file.originalname}:`, err.message);
                }
            }

            logger.info(`ZIP download: ${processed}/${files.length} images compressed for ${req.user?.email || 'anonymous'}`);
            await archive.finalize();

        } catch (error) {
            logger.error('ZIP compression error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: 'ZIP compression failed' });
            }
        }
    }
);

// POST /api/images/info - Get image metadata without compressing
router.post('/info',
    optionalAuth,
    upload.array('images', 10),
    async (req, res) => {
        try {
            const files = req.files || [];
            if (files.length === 0) {
                return res.status(400).json({ error: 'No files provided' });
            }

            const results = [];
            for (const file of files) {
                try {
                    const metadata = await sharp(file.buffer, { failOn: 'none' }).metadata();
                    results.push({
                        filename: file.originalname,
                        size: file.size,
                        sizeMB: (file.size / 1024 / 1024).toFixed(2),
                        format: metadata.format,
                        width: metadata.width,
                        height: metadata.height,
                        channels: metadata.channels,
                        colorSpace: metadata.space,
                        hasAlpha: metadata.hasAlpha || false,
                        isAnimated: metadata.pages > 1 || false,
                        density: metadata.density || null,
                        orientation: metadata.orientation || null,
                        hasExif: !!metadata.exif,
                        hasIcc: !!metadata.icc,
                        hasXmp: !!metadata.xmp,
                        bitsPerPixel: metadata.channels * (metadata.depth === 'uchar' ? 8 : 16),
                        megapixels: ((metadata.width * metadata.height) / 1000000).toFixed(2),
                        aspectRatio: (metadata.width / metadata.height).toFixed(3),
                        estimatedCompressedSizes: {
                            jpeg_80: estimateSize(file.size, metadata, 'jpeg', 80),
                            webp_80: estimateSize(file.size, metadata, 'webp', 80),
                            avif_60: estimateSize(file.size, metadata, 'avif', 60)
                        }
                    });
                } catch (err) {
                    results.push({ filename: file.originalname, error: err.message });
                }
            }

            res.json({ images: results });
        } catch (error) {
            logger.error('Image info error:', error);
            res.status(500).json({ error: 'Failed to read image info' });
        }
    }
);

// POST /api/images/convert - Convert image format without quality loss
router.post('/convert',
    optionalAuth,
    upload.single('image'),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No file provided' });
            }

            const targetFormat = (req.body.format || 'webp').toLowerCase();
            if (!FORMAT_CONFIG[targetFormat]) {
                return res.status(400).json({ error: 'Invalid target format', supported: Object.keys(FORMAT_CONFIG) });
            }

            let pipeline = sharp(req.file.buffer, { failOn: 'none' });
            const metadata = await pipeline.metadata();

            // Auto-rotate based on EXIF
            pipeline = pipeline.rotate();

            // Flatten alpha for formats that don't support it well
            if (metadata.hasAlpha && (targetFormat === 'jpeg')) {
                pipeline = pipeline.flatten({ background: '#FFFFFF' });
            }

            // Use high quality for conversion (near-lossless)
            pipeline = applyOutputFormat(pipeline, targetFormat, 95, metadata);
            const convertedBuffer = await pipeline.toBuffer();

            const nameWithoutExt = req.file.originalname.replace(/\.[^/.]+$/, '');

            res.json({
                originalName: req.file.originalname,
                originalFormat: metadata.format,
                originalSize: req.file.size,
                convertedFormat: targetFormat,
                convertedSize: convertedBuffer.length,
                outputFilename: `${nameWithoutExt}${FORMAT_CONFIG[targetFormat].ext}`,
                compressionRatio: ((req.file.size - convertedBuffer.length) / req.file.size * 100).toFixed(1),
                mimeType: FORMAT_CONFIG[targetFormat].mime,
                data: convertedBuffer.toString('base64')
            });

        } catch (error) {
            logger.error('Format conversion error:', error);
            res.status(500).json({ error: 'Conversion failed', message: error.message });
        }
    }
);

// GET /api/images/formats - List supported formats and capabilities
router.get('/formats', (req, res) => {
    res.json({
        inputFormats: ['jpeg', 'png', 'webp', 'heic', 'heif', 'tiff', 'gif', 'bmp', 'svg', 'avif', 'ico', 'pdf', 'jfif'],
        outputFormats: Object.entries(FORMAT_CONFIG).map(([key, val]) => ({
            format: key,
            label: val.label,
            mime: val.mime,
            extension: val.ext,
            supportsTransparency: val.supportsAlpha,
            supportsAnimation: key === 'webp' || key === 'gif'
        })),
        features: {
            compression: true,
            resize: true,
            formatConversion: true,
            metadataStripping: true,
            dpiControl: true,
            colorSpaceConversion: true,
            watermark: 'premium',
            batchZipDownload: true,
            maxBatchSize: { free: 5, premium: 50 },
            maxFileSize: { free: '10MB', premium: '100MB' }
        },
        dpiOptions: [72, 96, 150, 200, 300, 600],
        colorSpaces: ['srgb', 'p3', 'cmyk']
    });
});

// GET /api/images/limits - Get current user's upload limits
router.get('/limits', optionalAuth, async (req, res) => {
    try {
        const isPremium = req.user?.is_premium || false;

        const settingsResult = await query(
            `SELECT setting_key, setting_value
             FROM admin_settings
             WHERE setting_key IN (
                'max_file_size_free_mb', 'max_file_size_premium_mb',
                'max_files_per_batch_free', 'max_files_per_batch_premium'
             )`
        );

        const settings = {};
        settingsResult.rows.forEach(row => {
            settings[row.setting_key] = parseInt(row.setting_value);
        });

        res.json({
            limits: {
                maxFileSizeMB: isPremium ?
                    (settings.max_file_size_premium_mb || 100) :
                    (settings.max_file_size_free_mb || 10),
                maxFilesPerBatch: isPremium ?
                    (settings.max_files_per_batch_premium || 50) :
                    (settings.max_files_per_batch_free || 5),
                isPremium,
                isAuthenticated: !!req.user,
                supportedFormats: Object.keys(FORMAT_CONFIG),
                features: {
                    watermark: isPremium,
                    batchZip: true,
                    formatConversion: true,
                    metadataStripping: true
                }
            }
        });

    } catch (error) {
        logger.error('Get limits error:', error);
        res.status(500).json({ error: 'Failed to get limits' });
    }
});

// GET /api/images/history - Get user's compression history
router.get('/history', verifyToken, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const historyResult = await query(
            `SELECT
                original_filename, original_size_bytes, compressed_size_bytes,
                compression_ratio, quality_setting, processing_time_ms,
                compression_method, created_at
             FROM image_processing_logs
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [req.user.id, parseInt(limit), offset]
        );

        const countResult = await query(
            'SELECT COUNT(*) as total FROM image_processing_logs WHERE user_id = ?',
            [req.user.id]
        );

        const history = historyResult.rows.map(row => ({
            originalFilename: row.original_filename,
            originalSizeBytes: parseInt(row.original_size_bytes),
            originalSizeMB: (parseInt(row.original_size_bytes) / 1024 / 1024).toFixed(2),
            compressedSizeBytes: parseInt(row.compressed_size_bytes),
            compressedSizeMB: (parseInt(row.compressed_size_bytes) / 1024 / 1024).toFixed(2),
            compressionRatio: parseFloat(row.compression_ratio).toFixed(1),
            qualitySetting: parseInt(row.quality_setting),
            processingTimeMs: parseInt(row.processing_time_ms),
            compressionMethod: row.compression_method,
            processedAt: row.created_at
        }));

        const totalRecords = parseInt(countResult.rows[0].total);
        const totalPages = Math.ceil(totalRecords / parseInt(limit));

        res.json({
            history,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalRecords,
                hasNextPage: parseInt(page) < totalPages,
                hasPreviousPage: parseInt(page) > 1
            }
        });

    } catch (error) {
        logger.error('Get history error:', error);
        res.status(500).json({ error: 'Failed to get history' });
    }
});

// --- Helper functions ---

function createWatermarkSvg(text, imgWidth, imgHeight, opacity) {
    const fontSize = Math.max(16, Math.round(Math.min(imgWidth, imgHeight) * 0.04));
    const padding = fontSize;
    return `<svg width="${imgWidth}" height="${imgHeight}">
        <style>
            .watermark {
                font-family: Arial, Helvetica, sans-serif;
                font-size: ${fontSize}px;
                fill: rgba(255, 255, 255, ${opacity});
                text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
            }
        </style>
        <text x="${imgWidth - padding}" y="${imgHeight - padding}"
              text-anchor="end" class="watermark">${escapeHtml(text)}</text>
    </svg>`;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function estimateSize(originalSize, metadata, format, quality) {
    // Rough estimation multipliers based on format and quality
    const baseRatio = quality / 100;
    const multipliers = { jpeg: 0.15, webp: 0.12, avif: 0.08, png: 0.6, tiff: 0.7, gif: 0.4, heif: 0.1 };
    const estimated = Math.round(originalSize * (multipliers[format] || 0.15) * baseRatio);
    return `~${(estimated / 1024).toFixed(0)}KB`;
}

module.exports = router;
