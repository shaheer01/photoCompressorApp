const logger = require('../utils/logger');

const errorHandler = (error, req, res, next) => {
    let statusCode = error.statusCode || 500;
    let message = error.message || 'Internal Server Error';
    
    // Log the error
    logger.error('Error occurred:', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: req.user?.id || 'anonymous'
    });

    // Handle specific error types
    if (error.name === 'ValidationError') {
        statusCode = 400;
        message = 'Validation Error';
    } else if (error.name === 'CastError') {
        statusCode = 400;
        message = 'Invalid data format';
    } else if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) { // MySQL unique violation
        statusCode = 409;
        message = 'Resource already exists';
    } else if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.errno === 1452) { // MySQL foreign key violation
        statusCode = 400;
        message = 'Invalid reference data';
    } else if (error.code === 'ER_BAD_NULL_ERROR' || error.errno === 1048) { // MySQL not null violation
        statusCode = 400;
        message = 'Required field missing';
    } else if (error.code === 'ER_DATA_TOO_LONG' || error.errno === 1406) { // MySQL data too long
        statusCode = 400;
        message = 'Input data exceeds maximum length';
    }

    // Don't expose sensitive error details in production
    if (process.env.NODE_ENV === 'production') {
        if (statusCode === 500) {
            message = 'Internal Server Error';
        }
        
        res.status(statusCode).json({
            error: message,
            timestamp: new Date().toISOString(),
            requestId: req.id || 'unknown'
        });
    } else {
        // Development environment - include more details
        res.status(statusCode).json({
            error: message,
            stack: error.stack,
            timestamp: new Date().toISOString(),
            requestId: req.id || 'unknown',
            details: error.details || null
        });
    }
};

module.exports = errorHandler;