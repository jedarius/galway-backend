// src/middleware/errorHandler.js
// Global error handling middleware

const { PrismaClientKnownRequestError, PrismaClientValidationError } = require('@prisma/client/runtime/library');

const errorHandler = (error, req, res, next) => {
  console.error('Error occurred:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  // Handle Prisma errors
  if (error instanceof PrismaClientKnownRequestError) {
    return handlePrismaError(error, res);
  }

  if (error instanceof PrismaClientValidationError) {
    return res.status(400).json({
      error: 'Validation error',
      message: 'Invalid data provided to database',
      code: 'PRISMA_VALIDATION_ERROR',
    });
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Invalid token',
      message: 'The provided authentication token is invalid',
      code: 'INVALID_JWT',
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Token expired',
      message: 'Your session has expired, please log in again',
      code: 'EXPIRED_JWT',
    });
  }

  // Handle validation errors
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      message: error.message,
      code: 'VALIDATION_ERROR',
      details: error.details || null,
    });
  }

  // Handle custom application errors
  if (error.status || error.statusCode) {
    return res.status(error.status || error.statusCode).json({
      error: error.name || 'Application Error',
      message: error.message,
      code: error.code || 'APPLICATION_ERROR',
    });
  }

  // Handle file upload errors
  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'File too large',
      message: 'The uploaded file exceeds the maximum size limit',
      code: 'FILE_TOO_LARGE',
    });
  }

  if (error.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      error: 'Unexpected file',
      message: 'An unexpected file was uploaded',
      code: 'UNEXPECTED_FILE',
    });
  }

  // Default server error
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred' 
      : error.message,
    code: 'INTERNAL_SERVER_ERROR',
    ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
  });
};

const handlePrismaError = (error, res) => {
  switch (error.code) {
    case 'P2002':
      // Unique constraint violation
      const field = error.meta?.target?.[0] || 'field';
      return res.status(409).json({
        error: 'Duplicate entry',
        message: `A record with this ${field} already exists`,
        code: 'DUPLICATE_ENTRY',
        field: field,
      });

    case 'P2025':
      // Record not found
      return res.status(404).json({
        error: 'Record not found',
        message: 'The requested record does not exist',
        code: 'RECORD_NOT_FOUND',
      });

    case 'P2003':
      // Foreign key constraint violation
      return res.status(400).json({
        error: 'Invalid reference',
        message: 'The operation references a non-existent record',
        code: 'FOREIGN_KEY_VIOLATION',
      });

    case 'P2014':
      // Required relation violation
      return res.status(400).json({
        error: 'Required relation missing',
        message: 'A required relationship is missing',
        code: 'REQUIRED_RELATION_VIOLATION',
      });

    case 'P2011':
      // Null constraint violation
      return res.status(400).json({
        error: 'Required field missing',
        message: 'A required field is missing',
        code: 'NULL_CONSTRAINT_VIOLATION',
      });

    case 'P2012':
      // Missing required value
      return res.status(400).json({
        error: 'Missing required value',
        message: 'A required value is missing',
        code: 'MISSING_REQUIRED_VALUE',
      });

    case 'P2016':
      // Query interpretation error
      return res.status(400).json({
        error: 'Query error',
        message: 'The query could not be interpreted',
        code: 'QUERY_INTERPRETATION_ERROR',
      });

    default:
      console.error('Unhandled Prisma error:', error);
      return res.status(500).json({
        error: 'Database error',
        message: 'An unexpected database error occurred',
        code: 'DATABASE_ERROR',
      });
  }
};

// Custom error classes
class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.details = details;
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

module.exports = errorHandler;