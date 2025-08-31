// routes/auth.js - Fixed Enhanced Authentication with JWT
const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const JWTService = require('../utils/jwt');
const AuthMiddleware = require('../middleware/auth');
const { ResponseWrapper, ValidationError, UnauthorizedError, ConflictError } = require('../middleware/errorHandler');

const router = express.Router();
const prisma = new PrismaClient();

console.log('🔐 Enhanced Authentication routes loaded!');

// Store refresh tokens (in production, use Redis or database)
const refreshTokenStore = new Map();

// Helper function to generate ID number (from your existing system)
const generateIdNo = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// POST /api/auth/register - User registration
router.post('/register',
  [
    body('username').isLength({ min: 3, max: 20 }).withMessage('Username must be 3-20 characters')
      .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores'),
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase, and number'),
    body('country').optional().isLength({ min: 1, max: 4 }).withMessage('Country must be 1-4 characters')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Registration validation failed', errors.array());
      }

      const { username, email, password, country } = req.body;

      // FIXED: Check for existing user (users not user)
      const existingUser = await prisma.users.findFirst({
        where: {
          OR: [
            { username },
            { email }
          ]
        }
      });

      if (existingUser) {
        throw new ConflictError(
          existingUser.username === username ? 'Username already exists' : 'Email already registered'
        );
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 12);

      // Generate unique ID number
      let idNo;
      let isUnique = false;
      while (!isUnique) {
        idNo = generateIdNo();
        const existingId = await prisma.users.findUnique({ where: { id_no: idNo } });
        isUnique = !existingId;
      }

      // FIXED: Create user (users not user, proper field names)
      const user = await prisma.users.create({
        data: {
          username,
          email,
          password_hash: hashedPassword,
          id_no: idNo,
          country: country || null,
          role: 'operative', // Default role
          created_at: new Date(),
          updated_at: new Date()
        },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          id_no: true,
          created_at: true
        }
      });

      // FIXED: Generate initial inventory (inventory_items not inventoryItem)
      await prisma.inventory_items.create({
        data: {
          user_id: user.id,
          item_type: 'seed',
          quantity: 3,
          source_type: 'awarded',
          source_reference: 'new_user_bonus',
          grid_position: 0,
          created_at: new Date()
        }
      });

      // Generate tokens
      const tokens = JWTService.generateTokens(user);

      // Store refresh token
      refreshTokenStore.set(tokens.refreshToken, {
        userId: user.id,
        createdAt: new Date(),
        lastUsed: new Date()
      });

      return ResponseWrapper.created(res, {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          idNo: user.id_no,
          joinedDate: user.created_at
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn
        },
        bonuses: {
          welcomeSeeds: 3,
          message: 'Welcome to Galway Research! You\'ve received 3 seeds to start growing olive branches.'
        }
      }, 'Registration successful');
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/login - User login
router.post('/login',
  [
    body('identifier').notEmpty().withMessage('Username or email required'),
    body('password').notEmpty().withMessage('Password required'),
    body('remember').optional().isBoolean().withMessage('Remember must be boolean')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Login validation failed', errors.array());
      }

      const { identifier, password, remember = false } = req.body;

      // FIXED: Find user by username or email (users not user)
      const user = await prisma.users.findFirst({
        where: {
          OR: [
            { username: identifier },
            { email: identifier }
          ]
        },
        select: {
          id: true,
          username: true,
          email: true,
          password_hash: true,
          role: true,
          created_at: true,
          active_olive_branch_id: true
        }
      });

      if (!user) {
        throw new UnauthorizedError('Invalid credentials');
      }

      // FIXED: Verify password (password_hash not password)
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      if (!isValidPassword) {
        throw new UnauthorizedError('Invalid credentials');
      }

      // Update user timestamp
      await prisma.users.update({
        where: { id: user.id },
        data: { updated_at: new Date() }
      });

      // Generate tokens
      const tokens = JWTService.generateTokens(user);

      // Store refresh token
      refreshTokenStore.set(tokens.refreshToken, {
        userId: user.id,
        createdAt: new Date(),
        lastUsed: new Date(),
        extended: remember
      });

      // Remove password from response
      const { password_hash: _, ...userResponse } = user;

      return ResponseWrapper.success(res, {
        user: userResponse,
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: tokens.expiresIn
        },
        session: {
          loginTime: new Date().toISOString(),
          rememberMe: remember
        }
      }, 'Login successful');
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/refresh - Refresh access token
router.post('/refresh',
  [
    body('refreshToken').notEmpty().withMessage('Refresh token required')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Refresh validation failed', errors.array());
      }

      const { refreshToken } = req.body;

      // Verify refresh token
      let decoded;
      try {
        decoded = JWTService.verifyRefreshToken(refreshToken);
      } catch (error) {
        throw new UnauthorizedError('Invalid refresh token');
      }

      // Check if refresh token is stored and valid
      const storedToken = refreshTokenStore.get(refreshToken);
      if (!storedToken || storedToken.userId !== decoded.userId) {
        throw new UnauthorizedError('Refresh token not found');
      }

      // FIXED: Get fresh user data (users not user)
      const user = await prisma.users.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          username: true,
          role: true,
          active_olive_branch_id: true
        }
      });

      if (!user) {
        throw new UnauthorizedError('User not found or inactive');
      }

      // Generate new tokens
      const newTokens = JWTService.generateTokens(user);

      // Remove old refresh token and store new one
      refreshTokenStore.delete(refreshToken);
      refreshTokenStore.set(newTokens.refreshToken, {
        userId: user.id,
        createdAt: new Date(),
        lastUsed: new Date(),
        extended: storedToken.extended
      });

      return ResponseWrapper.success(res, {
        tokens: {
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken,
          expiresIn: newTokens.expiresIn
        },
        user: {
          username: user.username,
          role: user.role
        }
      }, 'Token refreshed successfully');
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/auth/me - Get current user info
router.get('/me',
  AuthMiddleware.requireAuth,
  async (req, res, next) => {
    try {
      // FIXED: users not user
      const user = await prisma.users.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          country: true,
          created_at: true,
          active_olive_branch_id: true
        }
      });

      if (!user) {
        throw new UnauthorizedError('User not found');
      }

      return ResponseWrapper.success(res, {
        user: {
          ...user,
          permissions: req.user.permissions
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/auth/logout - User logout
router.post('/logout',
  AuthMiddleware.requireAuth,
  [
    body('refreshToken').optional().isString().withMessage('Refresh token must be string'),
    body('allDevices').optional().isBoolean().withMessage('allDevices must be boolean')
  ],
  async (req, res, next) => {
    try {
      const { refreshToken, allDevices = false } = req.body;
      const userId = req.user.id;

      if (allDevices) {
        // Remove all refresh tokens for this user
        const tokensToDelete = [];
        for (const [token, data] of refreshTokenStore.entries()) {
          if (data.userId === userId) {
            tokensToDelete.push(token);
          }
        }
        tokensToDelete.forEach(token => refreshTokenStore.delete(token));
      } else if (refreshToken) {
        // Remove specific refresh token
        refreshTokenStore.delete(refreshToken);
      }

      return ResponseWrapper.success(res, {
        loggedOut: true,
        allDevices,
        message: allDevices ? 'Logged out from all devices' : 'Logged out successfully'
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;