// src/middleware/auth.js
// Authentication and authorization middleware

const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Verify JWT token and add user to request
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide a valid Bearer token',
        code: 'AUTH_TOKEN_MISSING',
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user still exists and account is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        emailVerified: true,
        lockedUntil: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'User account not found',
        code: 'USER_NOT_FOUND',
      });
    }

    // Check if account is locked
    if (user.lockedUntil && new Date() < user.lockedUntil) {
      return res.status(423).json({
        error: 'Account locked',
        message: 'Your account is temporarily locked due to security reasons',
        code: 'ACCOUNT_LOCKED',
        lockedUntil: user.lockedUntil,
      });
    }

    // Check if email is verified for actions that require it
    const emailVerificationRequired = await prisma.siteConfig.findUnique({
      where: { key: 'email_verification_required' },
    });

    if (emailVerificationRequired?.value && !user.emailVerified) {
      // Allow access to email verification and basic profile endpoints
      const allowedPaths = ['/api/auth/verify-email', '/api/auth/resend-verification', '/api/users/profile'];
      if (!allowedPaths.some(path => req.path.startsWith(path))) {
        return res.status(403).json({
          error: 'Email verification required',
          message: 'Please verify your email address to access this feature',
          code: 'EMAIL_VERIFICATION_REQUIRED',
        });
      }
    }

    // Update last activity
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Add user to request object
    req.user = user;
    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'The provided token is invalid',
        code: 'INVALID_TOKEN',
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Your session has expired, please log in again',
        code: 'TOKEN_EXPIRED',
      });
    }

    console.error('Auth middleware error:', error);
    return res.status(500).json({
      error: 'Authentication error',
      message: 'An error occurred during authentication',
      code: 'AUTH_ERROR',
    });
  }
};

// Optional authentication - adds user to request if token is valid, but doesn't require it
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // No token provided, continue without user
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    if (user) {
      req.user = user;
    }
    
    next();
  } catch (error) {
    // If token is invalid, just continue without user
    next();
  }
};

// Role-based authorization
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'You must be logged in to access this resource',
        code: 'AUTH_REQUIRED',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `This action requires one of the following roles: ${allowedRoles.join(', ')}`,
        code: 'INSUFFICIENT_PERMISSIONS',
        requiredRoles: allowedRoles,
        userRole: req.user.role,
      });
    }

    next();
  };
};

// Check if user owns resource or has admin privileges
const requireOwnershipOrAdmin = (getUserIdFromRequest) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }

      // Admin can access anything
      if (req.user.role === 'admin') {
        return next();
      }

      // Get the user ID from the request (params, body, or custom function)
      let resourceUserId;
      if (typeof getUserIdFromRequest === 'function') {
        resourceUserId = await getUserIdFromRequest(req);
      } else {
        resourceUserId = req.params.userId || req.body.userId;
      }

      if (!resourceUserId) {
        return res.status(400).json({
          error: 'Unable to determine resource ownership',
          code: 'OWNERSHIP_CHECK_FAILED',
        });
      }

      // Check if user owns the resource
      if (parseInt(resourceUserId) !== req.user.id) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'You can only access your own resources',
          code: 'RESOURCE_ACCESS_DENIED',
        });
      }

      next();
    } catch (error) {
      console.error('Ownership check error:', error);
      return res.status(500).json({
        error: 'Authorization error',
        code: 'AUTHORIZATION_ERROR',
      });
    }
  };
};

// Rate limiting for sensitive operations
const sensitiveOperationLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    error: 'Too many sensitive operations',
    message: 'Please wait before trying again',
    code: 'SENSITIVE_RATE_LIMIT',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  requireAuth,
  optionalAuth,
  requireRole,
  requireOwnershipOrAdmin,
  sensitiveOperationLimit,
};