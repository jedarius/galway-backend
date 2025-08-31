// utils/responseWrapper.js - Standardized API Responses
const { v4: uuidv4 } = require('uuid');

class ResponseWrapper {
  static success(res, data, message = 'Operation completed successfully', statusCode = 200) {
    const response = {
      success: true,
      data,
      message,
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId || uuidv4()
    };

    // Add pagination if present
    if (data && data.pagination) {
      response.pagination = data.pagination;
      response.data = data.data || data;
      delete response.data.pagination;
    }

    return res.status(statusCode).json(response);
  }

  static error(res, error, statusCode = 500, code = 'INTERNAL_SERVER_ERROR') {
    const response = {
      success: false,
      error: {
        code,
        message: error.message || error,
        details: error.details || {}
      },
      timestamp: new Date().toISOString(),
      requestId: res.locals.requestId || uuidv4()
    };

    // Add stack trace in development
    if (process.env.NODE_ENV === 'development' && error.stack) {
      response.error.stack = error.stack;
    }

    return res.status(statusCode).json(response);
  }

  static paginated(res, data, pagination, message = 'Data retrieved successfully') {
    return ResponseWrapper.success(res, {
      items: data,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages: Math.ceil(pagination.total / pagination.limit),
        hasNext: pagination.page < Math.ceil(pagination.total / pagination.limit),
        hasPrev: pagination.page > 1
      }
    }, message);
  }

  static created(res, data, message = 'Resource created successfully') {
    return ResponseWrapper.success(res, data, message, 201);
  }

  static updated(res, data, message = 'Resource updated successfully') {
    return ResponseWrapper.success(res, data, message, 200);
  }

  static deleted(res, message = 'Resource deleted successfully') {
    return ResponseWrapper.success(res, null, message, 200);
  }

  static notFound(res, message = 'Resource not found') {
    return ResponseWrapper.error(res, new Error(message), 404, 'NOT_FOUND');
  }

  static forbidden(res, message = 'Access forbidden') {
    return ResponseWrapper.error(res, new Error(message), 403, 'FORBIDDEN');
  }

  static unauthorized(res, message = 'Authentication required') {
    return ResponseWrapper.error(res, new Error(message), 401, 'UNAUTHORIZED');
  }

  static badRequest(res, message = 'Invalid request', details = {}) {
    const error = new Error(message);
    error.details = details;
    return ResponseWrapper.error(res, error, 400, 'BAD_REQUEST');
  }

  static validationError(res, validationErrors) {
    const error = new Error('Validation failed');
    error.details = validationErrors;
    return ResponseWrapper.error(res, error, 422, 'VALIDATION_ERROR');
  }

  static rateLimit(res, message = 'Too many requests') {
    return ResponseWrapper.error(res, new Error(message), 429, 'RATE_LIMIT_EXCEEDED');
  }
}

// middleware/errorHandler.js - Enhanced Error Handler
const ResponseWrapper = require('./responseWrapper');

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_SERVER_ERROR', details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = (error, req, res, next) => {
  // Set request ID for tracking
  if (!res.locals.requestId) {
    res.locals.requestId = req.headers['x-request-id'] || require('uuid').v4();
  }

  console.error(`[${res.locals.requestId}] Error:`, {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    user: req.user?.username || 'anonymous',
    timestamp: new Date().toISOString()
  });

  // Handle known operational errors
  if (error.isOperational) {
    return ResponseWrapper.error(res, error, error.statusCode, error.code);
  }

  // Handle JWT errors
  if (error.name === 'JsonWebTokenError') {
    return ResponseWrapper.unauthorized(res, 'Invalid token');
  }

  if (error.name === 'TokenExpiredError') {
    return ResponseWrapper.unauthorized(res, 'Token expired');
  }

  // Handle Prisma errors
  if (error.code === 'P2002') {
    return ResponseWrapper.error(res, 
      new Error('Duplicate entry - resource already exists'), 
      409, 
      'DUPLICATE_ENTRY'
    );
  }

  if (error.code === 'P2025') {
    return ResponseWrapper.notFound(res, 'Resource not found');
  }

  if (error.code && error.code.startsWith('P')) {
    return ResponseWrapper.error(res, 
      new Error('Database operation failed'), 
      500, 
      'DATABASE_ERROR'
    );
  }

  // Handle validation errors
  if (error.name === 'ValidationError') {
    const validationErrors = Object.values(error.errors).map(err => ({
      field: err.path,
      message: err.message,
      value: err.value
    }));
    return ResponseWrapper.validationError(res, validationErrors);
  }

  // Handle rate limiting
  if (error.code === 'RATE_LIMIT_EXCEEDED') {
    return ResponseWrapper.rateLimit(res, error.message);
  }

  // Handle unexpected errors
  return ResponseWrapper.error(res, 
    new Error(process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred' 
      : error.message
    ), 
    500, 
    'INTERNAL_SERVER_ERROR'
  );
};

// Custom error classes for common scenarios
class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, 422, 'VALIDATION_ERROR', details);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}

// Request ID middleware
const requestIdMiddleware = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || require('uuid').v4();
  res.locals.requestId = requestId;
  res.set('X-Request-ID', requestId);
  next();
};

module.exports = {
  ResponseWrapper,
  errorHandler,
  requestIdMiddleware,
  AppError,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  UnauthorizedError,
  ConflictError
};