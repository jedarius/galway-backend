// src/routes/auth.js
// Fixed authentication routes for Galway Research Institute

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const router = express.Router();
const prisma = new PrismaClient();

// Helper function to generate 6-digit ID
const generateUniqueId = async () => {
  let attempts = 0;
  const maxAttempts = 100;

  while (attempts < maxAttempts) {
    const id = Math.floor(100000 + Math.random() * 900000).toString();
    
    try {
      const existingUser = await prisma.user.findUnique({
        where: { idNo: id }
      });
      
      if (!existingUser) {
        return id;
      }
      
      attempts++;
    } catch (error) {
      console.error('Error checking ID uniqueness:', error);
      attempts++;
    }
  }
  
  throw new Error('Unable to generate unique ID after maximum attempts');
};

// ✅ NEW: Username availability check endpoint
router.post('/check-username', async (req, res) => {
  try {
    const { username } = req.body;

    // Basic validation
    if (!username || typeof username !== 'string') {
      return res.status(400).json({
        available: false,
        message: 'Username is required'
      });
    }

    // Check if username meets requirements
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({
        available: false,
        message: 'Username must be between 3-20 characters'
      });
    }

    if (!/^[a-z0-9._]+$/.test(username)) {
      return res.status(400).json({
        available: false,
        message: 'Username can only contain lowercase letters, numbers, dots, and underscores'
      });
    }

    if (/\.\./.test(username)) {
      return res.status(400).json({
        available: false,
        message: 'Username cannot contain consecutive periods'
      });
    }

    // Check database for existing username
    const existingUser = await prisma.user.findUnique({
      where: { username: username.toLowerCase() }
    });

    const isAvailable = !existingUser;

    res.json({
      available: isAvailable,
      message: isAvailable ? 'Username is available' : 'Username is already taken'
    });

  } catch (error) {
    console.error('Username check error:', error);
    res.status(500).json({
      available: false,
      message: 'Server error checking username availability'
    });
  }
});

// ✅ FIXED: Registration endpoint with proper validation
router.post('/register', [
  // Validation middleware
  body('username')
    .isLength({ min: 3, max: 20 })
    .withMessage('Username must be between 3-20 characters')
    .matches(/^[a-z0-9._]+$/)
    .withMessage('Username can only contain lowercase letters, numbers, dots, and underscores')
    .custom(value => {
      if (/\.\./.test(value)) {
        throw new Error('Username cannot contain consecutive periods');
      }
      return true;
    }),
  
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  
  // Optional fields validation
  body('phone')
    .optional()
    .matches(/^\+?[\d\s\-\(\)]{10,}$/)
    .withMessage('Please provide a valid phone number'),
  
  body('bio')
    .optional()
    .isLength({ max: 120 })
    .withMessage('Bio cannot exceed 120 characters'),
  
  body('birthday')
    .optional()
    .isISO8601()
    .withMessage('Please provide a valid date'),
  
  body('country')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Country name cannot exceed 100 characters'),
  
  body('city')
    .optional()
    .isLength({ max: 100 })
    .withMessage('City name cannot exceed 100 characters')

], async (req, res) => {
  try {
    // Check validation results
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Registration validation failed:', errors.array());
      return res.status(422).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      username,
      email,
      password,
      phone,
      bio,
      birthday,
      country,
      city
    } = req.body;

    console.log('📝 Registration attempt for:', { username, email });

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: username.toLowerCase() },
          { email: email.toLowerCase() }
        ]
      }
    });

    if (existingUser) {
      const field = existingUser.username === username.toLowerCase() ? 'username' : 'email';
      return res.status(409).json({
        message: `${field} already exists`,
        errors: [{
          path: field,
          msg: `This ${field} is already registered`
        }]
      });
    }

    // Hash password
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Generate unique ID
    const idNo = await generateUniqueId();

    // Create user
    const newUser = await prisma.user.create({
      data: {
        username: username.toLowerCase(),
        email: email.toLowerCase(),
        passwordHash,
        phone: phone || null,
        bio: bio || null,
        birthday: birthday ? new Date(birthday) : null,
        country: country || null,
        city: city || null,
        idNo,
        role: 'operative', // Default role
        emailVerified: false, // Requires email verification
        onsetDate: new Date(), // Registration date
        // Generate email verification token
        emailVerificationToken: crypto.randomBytes(16).toString('hex'),
        verificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        idNo: true,
        bio: true,
        onsetDate: true,
        emailVerified: true,
        createdAt: true
      }
    });

    console.log('✅ User created successfully:', { id: newUser.id, username: newUser.username });

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: newUser.id,
        username: newUser.username,
        role: newUser.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Registration successful',
      user: newUser,
      token,
      requiresEmailVerification: true
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    
    // Handle Prisma unique constraint errors
    if (error.code === 'P2002') {
      const field = error.meta?.target?.includes('username') ? 'username' : 'email';
      return res.status(409).json({
        message: `${field} already exists`,
        errors: [{
          path: field,
          msg: `This ${field} is already registered`
        }]
      });
    }

    res.status(500).json({
      message: 'Server error during registration',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ✅ FIXED: Login endpoint
router.post('/login', [
  body('login')
    .notEmpty()
    .withMessage('Username or email is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { login, password } = req.body;

    console.log('🔑 Login attempt for:', login);

    // Find user by username or email
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: login.toLowerCase() },
          { email: login.toLowerCase() }
        ]
      }
    });

    if (!user) {
      return res.status(401).json({
        message: 'Invalid credentials'
      });
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(423).json({
        message: 'Account is temporarily locked. Please try again later.'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      // Increment failed login attempts
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: user.failedLoginAttempts + 1,
          // Lock account after 5 failed attempts for 15 minutes
          lockedUntil: user.failedLoginAttempts >= 4 
            ? new Date(Date.now() + 15 * 60 * 1000) 
            : null
        }
      });

      return res.status(401).json({
        message: 'Invalid credentials'
      });
    }

    // Reset failed attempts and update last login
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLogin: new Date()
      }
    });

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id,
        username: user.username,
        role: user.role 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('✅ Login successful for:', user.username);

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        idNo: user.idNo,
        bio: user.bio,
        onsetDate: user.onsetDate,
        emailVerified: user.emailVerified
      },
      token
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      message: 'Server error during login',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ✅ NEW: Email verification endpoint
router.post('/verify-email', [
  body('token')
    .notEmpty()
    .withMessage('Verification token is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { token } = req.body;

    // Find user with valid token
    const user = await prisma.user.findFirst({
      where: {
        emailVerificationToken: token,
        verificationExpiresAt: {
          gt: new Date() // Token not expired
        }
      }
    });

    if (!user) {
      return res.status(400).json({
        message: 'Invalid or expired verification token'
      });
    }

    // Update user as verified
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        verificationExpiresAt: null
      }
    });

    console.log('✅ Email verified for user:', user.username);

    res.json({
      message: 'Email verified successfully'
    });

  } catch (error) {
    console.error('❌ Email verification error:', error);
    res.status(500).json({
      message: 'Server error during email verification',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ✅ NEW: Resend verification email endpoint
router.post('/resend-verification', [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email } = req.body;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      // Don't reveal if email exists or not for security
      return res.json({
        message: 'If an account with that email exists, a verification email has been sent'
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        message: 'Email is already verified'
      });
    }

    // Generate new verification token
    const verificationToken = crypto.randomBytes(16).toString('hex');

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: verificationToken,
        verificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      }
    });

    // TODO: Send verification email here
    // await emailService.sendVerificationEmail(user.email, verificationToken);

    console.log('✅ Verification email resent for:', user.email);

    res.json({
      message: 'Verification email sent'
    });

  } catch (error) {
    console.error('❌ Resend verification error:', error);
    res.status(500).json({
      message: 'Server error sending verification email',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ✅ NEW: Password reset request endpoint
router.post('/forgot-password', [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email } = req.body;

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    // Always return success message for security (don't reveal if email exists)
    if (!user) {
      return res.json({
        message: 'If an account with that email exists, a password reset email has been sent'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');

    // Store reset token in account recovery table
    await prisma.accountRecovery.create({
      data: {
        userId: user.id,
        recoveryType: 'email',
        recoveryToken: resetToken,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        ipAddress: req.ip,
        userAgent: req.get('User-Agent') || 'Unknown'
      }
    });

    // TODO: Send password reset email here
    // await emailService.sendPasswordResetEmail(user.email, resetToken);

    console.log('✅ Password reset requested for:', user.email);

    res.json({
      message: 'Password reset email sent'
    });

  } catch (error) {
    console.error('❌ Password reset request error:', error);
    res.status(500).json({
      message: 'Server error processing password reset request',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ✅ Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'auth',
    timestamp: new Date().toISOString(),
    endpoints: {
      'POST /check-username': 'Username availability check',
      'POST /register': 'User registration',
      'POST /login': 'User authentication', 
      'POST /verify-email': 'Email verification',
      'POST /resend-verification': 'Resend verification email',
      'POST /forgot-password': 'Password reset request'
    }
  });
});

module.exports = router;