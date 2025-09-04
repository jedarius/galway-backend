// middleware/auth.js - Fixed Authentication Middleware
const { PrismaClient } = require('@prisma/client');
const JWTService = require('../utils/jwt');
const { UnauthorizedError, ForbiddenError } = require('./errorHandler');

const prisma = new PrismaClient();

class AuthMiddleware {
  // Basic authentication - requires valid JWT
  static async requireAuth(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      const token = JWTService.extractTokenFromHeader(authHeader);
      
      if (!token) {
        throw new UnauthorizedError('Access token required');
      }

      // Verify and decode token
      const decoded = JWTService.verifyAccessToken(token);
      
      // Get fresh user data from database (FIXED: users not user)
      const user = await prisma.users.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          username: true,
          role: true,
          // Only select fields that exist in your schema
          created_at: true,
          updated_at: true,
          email: true
        }
      });

      if (!user) {
        throw new UnauthorizedError('User not found');
      }

      // Try to update last seen (optional - only if fields exist)
      try {
        await prisma.users.update({
          where: { id: user.id },
          data: {
            updated_at: new Date()
            // Only update fields that exist in your schema
          }
        });
      } catch (updateError) {
        // Gracefully handle if fields don't exist
        console.warn('Could not update timestamp - field may not exist in schema');
      }

      // Add user data to request
      req.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
        permissions: JWTService.getUserPermissions(user.role),
        token: decoded
      };

      next();
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return next(new UnauthorizedError('Invalid access token'));
      }
      if (error.name === 'TokenExpiredError') {
        return next(new UnauthorizedError('Access token expired'));
      }
      next(error);
    }
  }

  // Optional authentication - doesn't fail if no token
  static async optionalAuth(req, res, next) {
    try {
      const authHeader = req.headers.authorization;
      const token = JWTService.extractTokenFromHeader(authHeader);
      
      if (!token) {
        req.user = null;
        return next();
      }

      const decoded = JWTService.verifyAccessToken(token);
      const user = await prisma.users.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          username: true,
          role: true,
          created_at: true,
          email: true
        }
      });

      if (user) {
        req.user = {
          id: user.id,
          username: user.username,
          role: user.role,
          email: user.email,
          permissions: JWTService.getUserPermissions(user.role),
          token: decoded
        };
      } else {
        req.user = null;
      }

      next();
    } catch (error) {
      // Silently fail for optional auth
      req.user = null;
      next();
    }
  }

  // Require specific roles
  static requireRole(roles = []) {
    return (req, res, next) => {
      if (!req.user) {
        return next(new UnauthorizedError('Authentication required'));
      }

      const userRoles = Array.isArray(roles) ? roles : [roles];
      if (!userRoles.includes(req.user.role)) {
        return next(new ForbiddenError(`Access denied. Required role: ${userRoles.join(' or ')}`));
      }

      next();
    };
  }

  // Require specific permissions
  static requirePermission(permissions = []) {
    return (req, res, next) => {
      if (!req.user) {
        return next(new UnauthorizedError('Authentication required'));
      }

      const requiredPermissions = Array.isArray(permissions) ? permissions : [permissions];
      const userPermissions = req.user.permissions || [];

      // Admin has all permissions
      if (userPermissions.includes('*')) {
        return next();
      }

      // Check if user has required permissions
      const hasPermission = requiredPermissions.every(permission =>
        userPermissions.includes(permission)
      );

      if (!hasPermission) {
        return next(new ForbiddenError(`Missing required permissions: ${requiredPermissions.join(', ')}`));
      }

      next();
    };
  }

  // Enhanced admin middleware with audit logging
  static requireAdmin(req, res, next) {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    if (req.user.role !== 'admin') {
      console.warn(`Unauthorized admin access attempt by ${req.user.username} (${req.user.id}) to ${req.path}`);
      return next(new ForbiddenError('Administrator access required'));
    }

    next();
  }
}

// Exports
module.exports = AuthMiddleware;