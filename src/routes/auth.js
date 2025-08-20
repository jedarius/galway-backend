// src/routes/auth.js
// Complete Authentication routes - registration, login, password management

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { body, validationResult } = require('express-validator');

const { requireAuth, sensitiveOperationLimit } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Custom error classes (inline since we can't import them easily)
class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.statusCode = 400;
    this.code = 'VALIDATION_ERROR';
    this.details = details;
  }
}

class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized access') {
    super(message);
    this.statusCode = 401;
    this.code = 'UNAUTHORIZED';
  }
}

class ConflictError extends Error {
  constructor(message = 'Resource conflict') {
    super(message);
    this.statusCode = 409;
    this.code = 'CONFLICT';
  }
}

class ForbiddenError extends Error {
  constructor(message = 'Access forbidden') {
    super(message);
    this.statusCode = 403;
    this.code = 'FORBIDDEN';
  }
}

// Validation schemas
const registerValidation = [
  body('username')
    .isLength({ min: 3, max: 20 })
    .matches(/^[a-z0-9._]+$/)
    .withMessage('Username must be 3-20 characters, lowercase letters, numbers, dots, and underscores only'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must be at least 8 characters with uppercase, lowercase, and number'),
];

const loginValidation = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
];

// Helper function to generate unique ID number
const generateIdNo = async () => {
  let idNo;
  let isUnique = false;
  
  while (!isUnique) {
    idNo = Math.floor(100000 + Math.random() * 900000).toString();
    const existing = await prisma.user.findUnique({
      where: { idNo },
    });
    isUnique = !existing;
  }
  
  return idNo;
};

// Helper function to create JWT token
const createToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// POST /api/auth/register - User registration
router.post('/register', registerValidation, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const { username, email, password, referralCode } = req.body;

    // Check if registration is enabled
    const registrationEnabled = await prisma.siteConfig.findUnique({
      where: { key: 'registration_enabled' },
    });

    if (!registrationEnabled?.value) {
      throw new ForbiddenError('Registration is currently disabled');
    }

    // Check for existing user
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email },
        ],
      },
    });

    if (existingUser) {
      if (existingUser.username === username) {
        throw new ConflictError('Username already taken');
      }
      if (existingUser.email === email) {
        throw new ConflictError('Email already registered');
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    // Generate unique ID number
    const idNo = await generateIdNo();

    // Generate email verification token
    const emailVerificationToken = crypto.randomBytes(16).toString('hex');

    // Handle referral code if provided
    let referralCodeRecord = null;
    if (referralCode) {
      referralCodeRecord = await prisma.referralCode.findUnique({
        where: { code: referralCode, isActive: true },
        include: { user: true },
      });

      if (!referralCodeRecord || 
          (referralCodeRecord.maxUses && referralCodeRecord.currentUses >= referralCodeRecord.maxUses) ||
          (referralCodeRecord.expiresAt && new Date() > referralCodeRecord.expiresAt)) {
        throw new ValidationError('Invalid or expired referral code');
      }
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        idNo,
        emailVerificationToken,
        verificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
      select: {
        id: true,
        username: true,
        email: true,
        idNo: true,
        role: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    // Create referral relationship if applicable
    if (referralCodeRecord) {
      await prisma.referral.create({
        data: {
          referrerId: referralCodeRecord.userId,
          refereeId: user.id,
          referralCodeId: referralCodeRecord.id,
          signupCompleted: true,
          convertedAt: new Date(),
        },
      });

      // Update referral code usage
      await prisma.referralCode.update({
        where: { id: referralCodeRecord.id },
        data: { currentUses: { increment: 1 } },
      });
    }

    // Create initial inventory (starter seeds)
    await prisma.inventoryItem.create({
      data: {
        userId: user.id,
        itemType: 'seed',
        quantity: 3, // Start with 3 seeds
        sourceType: 'registration_bonus',
        gridPosition: 0,
      },
    });

    // Generate JWT token
    const token = createToken(user.id);

    // TODO: Send verification email
    console.log(`Verification token for ${email}: ${emailVerificationToken}`);

    res.status(201).json({
      message: 'Registration successful',
      user,
      token,
      requiresEmailVerification: true,
    });

  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        details: error.details || null,
      });
    }
    next(error);
  }
});

// POST /api/auth/login - User login
router.post('/login', loginValidation, async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Validation failed', errors.array());
    }

    const { email, password } = req.body;

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Check if account is locked
    if (user.lockedUntil && new Date() < user.lockedUntil) {
      throw new UnauthorizedError('Account is temporarily locked due to failed login attempts');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);

    if (!isValidPassword) {
      // Increment failed login attempts
      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: { increment: 1 },
          ...(user.failedLoginAttempts >= 4 && {
            lockedUntil: new Date(Date.now() + 30 * 60 * 1000), // Lock for 30 minutes
          }),
        },
      });

      if (updatedUser.failedLoginAttempts >= 5) {
        throw new UnauthorizedError('Account locked due to too many failed login attempts');
      }

      throw new UnauthorizedError('Invalid email or password');
    }

    // Reset failed login attempts on successful login
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLogin: new Date(),
      },
    });

    // Generate JWT token
    const token = createToken(user.id);

    // Return user data (excluding sensitive information)
    const userData = {
      id: user.id,
      username: user.username,
      email: user.email,
      idNo: user.idNo,
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    };

    res.json({
      message: 'Login successful',
      user: userData,
      token,
    });

  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

// POST /api/auth/verify-email - Verify email address
router.post('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      throw new ValidationError('Verification token is required');
    }

    const user = await prisma.user.findFirst({
      where: {
        emailVerificationToken: token,
        verificationExpiresAt: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid or expired verification token');
    }

    // Update user as verified
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        verificationExpiresAt: null,
      },
    });

    res.json({
      message: 'Email verified successfully',
    });

  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

// POST /api/auth/resend-verification - Resend verification email
router.post('/resend-verification', requireAuth, sensitiveOperationLimit, async (req, res, next) => {
  try {
    if (req.user.emailVerified) {
      throw new ValidationError('Email is already verified');
    }

    // Generate new verification token
    const emailVerificationToken = crypto.randomBytes(16).toString('hex');

    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        emailVerificationToken,
        verificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    // TODO: Send verification email
    console.log(`New verification token for ${req.user.email}: ${emailVerificationToken}`);

    res.json({
      message: 'Verification email sent',
    });

  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

// POST /api/auth/forgot-password - Request password reset
router.post('/forgot-password', sensitiveOperationLimit, async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new ValidationError('Email is required');
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Return success even if user doesn't exist (security best practice)
      return res.json({
        message: 'If an account with this email exists, a reset link has been sent',
      });
    }

    // Generate password reset token
    const resetToken = crypto.randomBytes(32).toString('hex');

    await prisma.accountRecovery.create({
      data: {
        userId: user.id,
        recoveryType: 'email',
        recoveryToken: resetToken,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      },
    });

    // TODO: Send password reset email
    console.log(`Password reset token for ${email}: ${resetToken}`);

    res.json({
      message: 'If an account with this email exists, a reset link has been sent',
    });

  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

// POST /api/auth/reset-password - Reset password with token
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      throw new ValidationError('Token and new password are required');
    }

    // Validate password strength
    if (newPassword.length < 8 || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      throw new ValidationError('Password must be at least 8 characters with uppercase, lowercase, and number');
    }

    // Find valid recovery token
    const recovery = await prisma.accountRecovery.findFirst({
      where: {
        recoveryToken: token,
        isUsed: false,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: true,
      },
    });

    if (!recovery) {
      throw new UnauthorizedError('Invalid or expired reset token');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    // Update user password and mark recovery as used
    await prisma.$transaction([
      prisma.user.update({
        where: { id: recovery.userId },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      prisma.accountRecovery.update({
        where: { id: recovery.id },
        data: {
          isUsed: true,
          usedAt: new Date(),
        },
      }),
    ]);

    res.json({
      message: 'Password reset successfully',
    });

  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

// GET /api/auth/me - Get current user info
router.get('/me', requireAuth, async (req, res) => {
  res.json({
    user: req.user,
  });
});

// POST /api/auth/logout - Logout (client-side token invalidation)
router.post('/logout', requireAuth, async (req, res) => {
  // In a more sophisticated setup, you might maintain a token blacklist
  // For now, logout is handled client-side by removing the token
  res.json({
    message: 'Logged out successfully',
  });
});

// GET /api/auth/test - Keep the test endpoint for verification
router.get('/test', (req, res) => {
  res.json({
    message: 'Complete auth system loaded!',
    timestamp: new Date().toISOString(),
    availableEndpoints: [
      'POST /api/auth/register',
      'POST /api/auth/login', 
      'POST /api/auth/verify-email',
      'POST /api/auth/resend-verification',
      'POST /api/auth/forgot-password',
      'POST /api/auth/reset-password',
      'GET /api/auth/me',
      'POST /api/auth/logout'
    ]
  });
});

module.exports = router;