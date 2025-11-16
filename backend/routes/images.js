const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { optionalAuth, verifyToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 100 * 1024 * 1024, // 100MB max
        files: 50 // Max 50 files
    },
    fileFilter: (req, file, cb) => {
        // Check file type
        const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only JPEG, PNG, and WebP images are allowed'), false);
        }
    }
});

// Middleware to check usage limits
const checkUsageLimits = async (req, res, next) => {
    try {
        const files = req.files || [];
        const isAuthenticated = !!req.user;
        const isPremium = req.user?.is_premium || false;

        // Get limits from admin settings
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

        // Check number of files
        if (files.length > maxFiles) {
            return res.status(413).json({
                error: 'Too many files',
                message: `${isPremium ? 'Premium' : 'Free'} users can upload up to ${maxFiles} files at once`,
                limits: {
                    maxFiles,
                    currentFiles: files.length,
                    upgradeRequired: !isPremium
                }
            });
        }

        // Check file sizes
        const maxFileSizeBytes = maxFileSize * 1024 * 1024;
        for (const file of files) {
            if (file.size > maxFileSizeBytes) {
                return res.status(413).json({
                    error: 'File too large',
                    message: `File "${file.originalname}" is ${(file.size / 1024 / 1024).toFixed(1)}MB. ${isPremium ? 'Premium' : 'Free'} users can upload files up to ${maxFileSize}MB`,
                    limits: {
                        maxFileSizeMB: maxFileSize,
                        fileSizeMB: (file.size / 1024 / 1024).toFixed(1),
                        upgradeRequired: !isPremium
                    }
                });
            }
        }

        next();
    } catch (error) {
        logger.error('Usage limits check error:', error);
        res.status(500).json({
            error: 'Failed to check usage limits',
            message: 'Internal server error'
        });
    }
};

// POST /api/images/compress - Compress images
router.post('/compress', 
    optionalAuth, 
    upload.array('images', 50), 
    checkUsageLimits,
    [
        body('quality').optional().isInt({ min: 1, max: 100 }).withMessage('Quality must be between 1 and 100')
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const files = req.files || [];
            // Ensure quality is an integer between 1-100
            let quality = parseInt(req.body.quality) || 80;
            // Handle case where quality might be sent as decimal (0-1 range)
            if (quality > 0 && quality < 1) {
                quality = Math.round(quality * 100);
            }
            // Clamp quality to valid range
            quality = Math.max(1, Math.min(100, quality));
            const sessionId = req.body.sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            if (files.length === 0) {
                return res.status(400).json({
                    error: 'No files provided',
                    message: 'Please select at least one image to compress'
                });
            }

            const results = [];
            const startTime = Date.now();

            // Process each file
            for (const file of files) {
                const fileStartTime = Date.now();
                let result = {
                    originalName: file.originalname,
                    originalSize: file.size,
                    originalSizeMB: (file.size / 1024 / 1024).toFixed(2),
                    success: false
                };

                try {
                    // Compress using Sharp (more reliable than browser-based compression)
                    let pipeline = sharp(file.buffer);

                    // Get image metadata to handle different formats properly
                    const metadata = await pipeline.metadata();

                    console.log(`📸 Processing: ${file.originalname}`);
                    console.log(`   Format: ${metadata.format}, Has Alpha: ${metadata.hasAlpha || false}`);
                    console.log(`   Dimensions: ${metadata.width}x${metadata.height}`);
                    console.log(`   Quality Setting: ${quality}%`);

                    // If image has transparency, composite it onto white background
                    if (metadata.hasAlpha) {
                        console.log(`   🎨 Removing transparency, applying white background`);
                        pipeline = pipeline.flatten({ background: '#FFFFFF' });
                    }

                    // Apply JPEG compression with optimized settings
                    const compressedBuffer = await pipeline
                        .jpeg({
                            quality: quality,
                            progressive: true,
                            mozjpeg: true,
                            optimiseScans: true,
                            chromaSubsampling: '4:2:0' // Better compression for photos
                        })
                        .toBuffer();

                    const compressionRatio = ((file.size - compressedBuffer.length) / file.size * 100);
                    const processingTime = Date.now() - fileStartTime;

                    console.log(`   ✅ Compressed: ${(file.size / 1024).toFixed(1)}KB → ${(compressedBuffer.length / 1024).toFixed(1)}KB`);
                    console.log(`   📊 Compression Ratio: ${compressionRatio.toFixed(1)}% smaller`);
                    console.log(`   ⏱️  Processing Time: ${processingTime}ms`);

                    result = {
                        ...result,
                        compressedSize: compressedBuffer.length,
                        compressedSizeMB: (compressedBuffer.length / 1024 / 1024).toFixed(2),
                        compressionRatio: compressionRatio.toFixed(1),
                        savingsBytes: file.size - compressedBuffer.length,
                        savingsMB: ((file.size - compressedBuffer.length) / 1024 / 1024).toFixed(2),
                        processingTimeMs: processingTime,
                        compressedData: compressedBuffer.toString('base64'),
                        mimeType: 'image/jpeg',
                        success: true
                    };

                    // Log processing statistics
                    await query(
                        `INSERT INTO image_processing_logs 
                         (user_id, session_id, original_filename, original_size_bytes, 
                          compressed_size_bytes, compression_ratio, quality_setting, 
                          processing_time_ms, compression_method, user_agent, ip_address)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sharp', $9, $10)`,
                        [
                            req.user?.id || null,
                            sessionId,
                            file.originalname,
                            file.size,
                            compressedBuffer.length,
                            compressionRatio,
                            quality,
                            processingTime,
                            req.get('User-Agent'),
                            req.ip
                        ]
                    );

                    // Update user usage statistics
                    if (req.user?.id) {
                        await query(
                            `INSERT INTO usage_statistics 
                             (user_id, date, images_processed, total_original_size_mb, 
                              total_compressed_size_mb, total_savings_mb)
                             VALUES ($1, CURRENT_DATE, 1, $2, $3, $4)
                             ON CONFLICT (user_id, date) 
                             DO UPDATE SET 
                                images_processed = usage_statistics.images_processed + 1,
                                total_original_size_mb = usage_statistics.total_original_size_mb + $2,
                                total_compressed_size_mb = usage_statistics.total_compressed_size_mb + $3,
                                total_savings_mb = usage_statistics.total_savings_mb + $4`,
                            [
                                req.user.id,
                                file.size / 1024 / 1024,
                                compressedBuffer.length / 1024 / 1024,
                                (file.size - compressedBuffer.length) / 1024 / 1024
                            ]
                        );
                    }

                } catch (compressionError) {
                    logger.error(`Compression failed for ${file.originalname}:`, compressionError);
                    result.error = 'Compression failed';
                    result.errorMessage = 'Unable to compress this image. Please try a different file.';
                }

                results.push(result);
            }

            const totalProcessingTime = Date.now() - startTime;
            const successfulCompressions = results.filter(r => r.success).length;
            
            // Calculate overall statistics
            const totalOriginalSize = results.reduce((sum, r) => sum + r.originalSize, 0);
            const totalCompressedSize = results.reduce((sum, r) => sum + (r.compressedSize || 0), 0);
            const overallCompressionRatio = totalOriginalSize > 0 ? 
                ((totalOriginalSize - totalCompressedSize) / totalOriginalSize * 100).toFixed(1) : 0;

            logger.info(`Compressed ${successfulCompressions}/${files.length} images for ${req.user?.email || 'anonymous'} in ${totalProcessingTime}ms`);

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
                    quality
                },
                sessionId
            });

        } catch (error) {
            logger.error('Image compression error:', error);
            res.status(500).json({
                error: 'Compression failed',
                message: 'Internal server error during image compression'
            });
        }
    }
);

// GET /api/images/limits - Get current user's upload limits
router.get('/limits', optionalAuth, async (req, res) => {
    try {
        const isPremium = req.user?.is_premium || false;
        
        // Get limits from admin settings
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

        const limits = {
            maxFileSizeMB: isPremium ? 
                (settings.max_file_size_premium_mb || 100) : 
                (settings.max_file_size_free_mb || 10),
            maxFilesPerBatch: isPremium ? 
                (settings.max_files_per_batch_premium || 50) : 
                (settings.max_files_per_batch_free || 5),
            isPremium,
            isAuthenticated: !!req.user
        };

        res.json({ limits });

    } catch (error) {
        logger.error('Get limits error:', error);
        res.status(500).json({
            error: 'Failed to get limits',
            message: 'Internal server error'
        });
    }
});

// GET /api/images/history - Get user's compression history (requires auth)
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
             WHERE user_id = $1 
             ORDER BY created_at DESC 
             LIMIT $2 OFFSET $3`,
            [req.user.id, parseInt(limit), offset]
        );

        const countResult = await query(
            'SELECT COUNT(*) as total FROM image_processing_logs WHERE user_id = $1',
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
        res.status(500).json({
            error: 'Failed to get history',
            message: 'Internal server error'
        });
    }
});

module.exports = router;