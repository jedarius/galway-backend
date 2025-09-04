// server.js - Updated Integration with Phase 4: E-Commerce System + Forum System
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');

// Import enhanced middleware
const { errorHandler, requestIdMiddleware } = require('./middleware/errorHandler');
const AuthMiddleware = require('./middleware/auth');

// Import routes
const authRoutes = require('./routes/auth');
const oliveBranchRoutes = require('./routes/oliveBranches');
const registrationBranchRoutes = require('./routes/registrationBranches');
const idCardRoutes = require('./routes/idCards');
const userRoutes = require('./routes/users'); // Phase 2: Enhanced user management
const searchRoutes = require('./routes/search'); // Phase 2: Advanced search
const inventoryRoutes = require('./routes/inventory'); // Phase 2: Inventory system
const leaderboardRoutes = require('./routes/leaderboards'); // Phase 3: Leaderboards
const achievementRoutes = require('./routes/achievements'); // Phase 3: Achievements

// PHASE 4 ROUTES - E-COMMERCE SYSTEM
const storeRoutes = require('./routes/store'); // Main store routes
const webhookRoutes = require('./routes/webhooks'); // Stripe webhooks
const adminStoreRoutes = require('./routes/store'); // Admin store management

// PHASE 4 ROUTES - FORUM SYSTEM (NEW)
const forumRoutes = require('./routes/forum'); // Forum system

console.log('🔍 Registration routes loaded:', typeof registrationBranchRoutes);
console.log('🆔 ID Card routes loaded:', typeof idCardRoutes);
console.log('👥 Enhanced User routes loaded:', typeof userRoutes);
console.log('🔍 Advanced Search routes loaded:', typeof searchRoutes);
console.log('🎒 Inventory routes loaded:', typeof inventoryRoutes);
console.log('🏆 Leaderboards routes loaded:', typeof leaderboardRoutes);
console.log('🎯 Achievements routes loaded:', typeof achievementRoutes);
console.log('🛍️ Store routes loaded:', typeof storeRoutes);
console.log('🔗 Webhook routes loaded:', typeof webhookRoutes);
console.log('⚙️ Admin Store routes loaded:', typeof adminStoreRoutes);
console.log('💬 Forum routes loaded:', typeof forumRoutes); // NEW

const app = express();
const PORT = process.env.PORT || 3000;

// Request ID middleware (must be first)
app.use(requestIdMiddleware);

// Security middleware with enhanced CSP
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "https://js.stripe.com"], // Allow Stripe JS
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "https://api.stripe.com"], // Allow Stripe API
      frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"], // Allow Stripe frames
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

// Enhanced rate limiting with different tiers
const createRateLimit = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message: { error: message, code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Different rate limits for different endpoint types
const generalRateLimit = createRateLimit(15 * 60 * 1000, 100, 'Too many requests from this IP');
const authRateLimit = createRateLimit(15 * 60 * 1000, 20, 'Too many authentication attempts');
const searchRateLimit = createRateLimit(60 * 1000, 30, 'Too many search requests');
const leaderboardRateLimit = createRateLimit(60 * 1000, 60, 'Too many leaderboard requests');
const storeRateLimit = createRateLimit(60 * 1000, 100, 'Too many store requests');
const checkoutRateLimit = createRateLimit(15 * 60 * 1000, 10, 'Too many checkout attempts');
const forumRateLimit = createRateLimit(60 * 1000, 50, 'Too many forum requests'); // NEW

// Apply rate limits to specific routes
app.use('/api/auth', authRateLimit);
app.use('/api/search', searchRateLimit);
app.use('/api/leaderboards', leaderboardRateLimit);
app.use('/api/achievements', searchRateLimit);
app.use('/api/store', storeRateLimit);
app.use('/api/store/checkout', checkoutRateLimit); // Stricter rate limit for checkout
app.use('/api/forum', forumRateLimit); // NEW

// Webhook routes BEFORE body parsing middleware (Stripe needs raw body)
app.use('/api/webhooks', webhookRoutes);

app.use(generalRateLimit); // General rate limit for all other routes

// Body parsing middleware (after webhooks to allow raw body for Stripe)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression and logging
app.use(compression());
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

// Serve static files for forum uploads
app.use('/uploads', express.static('uploads'));

// Health check endpoint with enhanced system status
app.get('/health', async (req, res) => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();

  let dbStatus = 'unknown';
  let dbLatency = null;
  let stripeStatus = 'unknown';

  try {
    const start = Date.now();
    await prisma.users.findFirst({ select: { id: true } });
    dbLatency = Date.now() - start;
    dbStatus = 'healthy';
  } catch (error) {
    dbStatus = 'unhealthy';
  } finally {
    await prisma.$disconnect();
  }

  // Check Stripe connection
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    await stripe.accounts.retrieve();
    stripeStatus = 'healthy';
  } catch (error) {
    stripeStatus = 'unhealthy';
  }

  const healthData = {
    status: dbStatus === 'healthy' && stripeStatus === 'healthy' ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '4.0.0', // Updated version
    services: {
      database: {
        status: dbStatus,
        latency: dbLatency ? `${dbLatency}ms` : null
      },
      stripe: {
        status: stripeStatus
      },
      api: {
        status: 'healthy',
        features: {
          authentication: 'operational',
          userManagement: 'operational',
          searchSystem: 'operational',
          inventorySystem: 'operational',
          leaderboards: 'operational',
          achievements: 'operational',
          ecommerce: 'operational',
          paymentProcessing: stripeStatus,
          forumSystem: 'operational', // NEW
          oliveBranches: 'operational',
          idCardGeneration: 'operational'
        }
      }
    }
  };

  res.status(dbStatus === 'healthy' && stripeStatus === 'healthy' ? 200 : 503).json(healthData);
});

// API version endpoint with comprehensive feature list
app.get('/api', (req, res) => {
  res.json({
    message: 'Galway Research Institute API',
    version: '4.0.0', // Updated to reflect Phase 4 completion
    documentation: '/api/docs',
    status: 'operational',
    features: {
      authentication: {
        jwt: true,
        refreshTokens: true,
        roleBasedAccess: true,
        permissions: true
      },
      userManagement: {
        profiles: true,
        statusTracking: true,
        activityMonitoring: true,
        bulkOperations: true
      },
      searchSystem: {
        advancedFiltering: true,
        realTimeSuggestions: true,
        multiCriteria: true,
        performantIndexing: true
      },
      inventorySystem: {
        dragAndDropReorder: true,
        autoOrganization: true,
        valueCalculation: true,
        typeSpecificHandling: true
      },
      leaderboards: {
        multiCategory: true,
        timePeriods: true,
        userRankings: true,
        realTimeUpdates: true
      },
      achievements: {
        progressTracking: true,
        rewardSystem: true,
        badgeSystem: true,
        categorization: true
      },
      ecommerce: {
        storeManagement: true,
        shoppingCart: true,
        orderProcessing: true,
        paymentIntegration: true,
        inventoryTracking: true,
        couponSystem: true,
        digitalDelivery: true,
        adminDashboard: true
      },
      forumSystem: { // NEW
        categories: true,
        threadManagement: true,
        postReplies: true,
        contentModeration: true,
        fileAttachments: true,
        studyVerification: true,
        upvoteSystem: true,
        moderationTools: true
      },
      oliveBranches: {
        generation: true,
        tradingSupport: true,
        raritySystem: true,
        svgRendering: true
      }
    },
    endpoints: {
      authentication: '/api/auth',
      users: '/api/users',
      search: '/api/search',
      inventory: '/api/inventory',
      leaderboards: '/api/leaderboards',
      achievements: '/api/achievements',
      store: '/api/store',
      admin: '/api/admin/store',
      webhooks: '/api/webhooks',
      forum: '/api/forum', // NEW
      oliveBranches: '/api/olive-branches',
      registration: '/api/registration',
      idCards: '/api/id-cards'
    }
  });
});

// API Routes with version prefix
const API_BASE = '/api/v1';

// Core system routes
app.use('/api/auth', authRoutes);
app.use(`${API_BASE}/users`, userRoutes);
app.use(`${API_BASE}/search`, searchRoutes);
app.use(`${API_BASE}/inventory`, inventoryRoutes);

// Phase 3 routes
app.use('/api/leaderboards', leaderboardRoutes);
app.use('/api/achievements', achievementRoutes);
app.use(`${API_BASE}/leaderboards`, leaderboardRoutes);
app.use(`${API_BASE}/achievements`, achievementRoutes);

// PHASE 4 ROUTES - E-COMMERCE SYSTEM
app.use('/api/store', storeRoutes); // Public store routes
app.use(`${API_BASE}/store`, storeRoutes); // Versioned store routes
app.use('/api/admin/store', adminStoreRoutes); // Admin store management
app.use(`${API_BASE}/admin/store`, adminStoreRoutes); // Versioned admin store management

// PHASE 4 ROUTES - FORUM SYSTEM (NEW)
app.use('/api/forum', forumRoutes); // Main forum routes
app.use(`${API_BASE}/forum`, forumRoutes); // Versioned forum routes

// Existing routes (maintained for compatibility)
app.use('/api/olive-branches', oliveBranchRoutes);
app.use('/api/registration', registrationBranchRoutes);
app.use('/api/id-cards', idCardRoutes);

// Legacy route aliases for backward compatibility
app.use('/api/users', userRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/inventory', inventoryRoutes);

console.log('🔍 Registration routes mounted at /api/registration');
console.log('🆔 ID Card routes mounted at /api/id-cards');
console.log('👥 User routes mounted at /api/v1/users and /api/users');
console.log('🔍 Search routes mounted at /api/v1/search and /api/search');
console.log('🎒 Inventory routes mounted at /api/v1/inventory and /api/inventory');
console.log('🏆 Leaderboards routes mounted at /api/leaderboards and /api/v1/leaderboards');
console.log('🎯 Achievements routes mounted at /api/achievements and /api/v1/achievements');
console.log('🛍️ Store routes mounted at /api/store and /api/v1/store');
console.log('⚙️ Admin Store routes mounted at /api/admin/store and /api/v1/admin/store');
console.log('🔗 Webhook routes mounted at /api/webhooks');
console.log('💬 Forum routes mounted at /api/forum and /api/v1/forum'); // NEW

// Enhanced system status endpoint
app.get('/api/status/features', AuthMiddleware.optionalAuth, async (req, res) => {
  const isAdmin = req.user?.role === 'admin';

  const publicStatus = {
    phase: 'Phase 1-4: Complete E-Commerce Platform + Forum System', // Updated
    status: 'operational',
    lastUpdated: '2025-08-28T23:30:00Z', // Updated timestamp
    features: {
      jwtAuthentication: {
        status: 'operational',
        description: 'JWT-based authentication with refresh tokens',
        endpoints: ['/api/auth/login', '/api/auth/refresh', '/api/auth/logout']
      },
      enhancedUserSystem: {
        status: 'operational',
        description: 'User profiles with status tracking and activity monitoring',
        endpoints: ['/api/v1/users', '/api/v1/users/:username', '/api/v1/users/stats/overview']
      },
      advancedSearch: {
        status: 'operational',
        description: 'Real-time search with filtering and suggestions',
        endpoints: ['/api/v1/search/users', '/api/v1/search/branches', '/api/v1/search/suggestions']
      },
      inventoryManagement: {
        status: 'operational',
        description: 'Complete inventory system with drag-and-drop support',
        endpoints: ['/api/v1/inventory/me', '/api/v1/inventory/display', '/api/v1/inventory/organize']
      },
      leaderboards: {
        status: 'operational',
        description: 'Multi-category leaderboard system with time periods and rankings',
        endpoints: ['/api/leaderboards', '/api/leaderboards/:id', '/api/leaderboards/user/:userId']
      },
      achievements: {
        status: 'operational',
        description: 'Achievement system with progress tracking and rewards',
        endpoints: ['/api/achievements', '/api/achievements/user/:id', '/api/achievements/:id/claim']
      },
      ecommerceStore: {
        status: 'operational',
        description: 'Complete e-commerce system with Stripe integration',
        endpoints: ['/api/store/items', '/api/store/cart', '/api/store/checkout', '/api/store/orders']
      },
      paymentProcessing: {
        status: 'operational',
        description: 'Secure payment processing with Stripe',
        endpoints: ['/api/store/checkout', '/api/webhooks/stripe']
      },
      adminDashboard: {
        status: 'operational',
        description: 'Admin interface for store and order management',
        endpoints: ['/api/admin/store/dashboard', '/api/admin/store/orders', '/api/admin/store/items']
      },
      forumSystem: { // NEW
        status: 'operational',
        description: 'Complete forum system with categories, threads, moderation, and study verification',
        endpoints: ['/api/forum/categories', '/api/forum/categories/:id/threads', '/api/forum/thread/:slug', '/api/forum/thread/:slug/reply']
      },
      oliveBranchSystem: {
        status: 'operational',
        description: 'Original olive branch generation and management',
        endpoints: ['/api/olive-branches/generate', '/api/olive-branches/:id']
      }
    }
  };

  // Add admin-only information
  if (isAdmin) {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    try {
      const [
        userCount,
        branchCount,
        inventoryItemCount,
        leaderboardCount,
        achievementCount,
        storeItemCount,
        orderCount,
        totalRevenue,
        forumThreadCount, // NEW
        forumPostCount, // NEW
        forumCategoryCount // NEW
      ] = await Promise.all([
        prisma.users.count(),
        prisma.olive_branches.count({ where: { is_active: true } }),
        prisma.inventory_items.count(),
        prisma.leaderboards.count({ where: { is_active: true } }),
        prisma.achievements.count({ where: { is_active: true } }),
        prisma.store_items.count({ where: { is_active: true } }),
        prisma.orders.count(),
        prisma.orders.aggregate({
          _sum: { total_cents: true },
          where: { payment_status: 'succeeded' }
        }),
        prisma.forum_threads.count({ where: { is_deleted: false } }), // NEW
        prisma.forum_posts.count({ where: { is_deleted: false } }), // NEW
        prisma.forum_categories.count({ where: { is_active: true } }) // NEW
      ]);

      publicStatus.adminStats = {
        totalUsers: userCount,
        totalBranches: branchCount,
        totalInventoryItems: inventoryItemCount,
        totalLeaderboards: leaderboardCount,
        totalAchievements: achievementCount,
        totalStoreItems: storeItemCount,
        totalOrders: orderCount,
        totalRevenueCents: totalRevenue._sum.total_cents || 0,
        totalRevenueFormatted: `$${((totalRevenue._sum.total_cents || 0) / 100).toFixed(2)}`,
        totalForumThreads: forumThreadCount, // NEW
        totalForumPosts: forumPostCount, // NEW
        totalForumCategories: forumCategoryCount, // NEW
        systemLoad: process.memoryUsage(),
        uptime: process.uptime()
      };

      await prisma.$disconnect();
    } catch (error) {
      console.error('Error fetching admin stats:', error);
    }
  }

  res.json(publicStatus);
});

// Enhanced 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `The endpoint ${req.method} ${req.originalUrl} does not exist`,
    },
    availableEndpoints: {
      core: [
        '/api/auth',
        '/api/v1/users',
        '/api/v1/search',
        '/api/v1/inventory'
      ],
      phase3: [
        '/api/leaderboards',
        '/api/achievements',
        '/api/v1/leaderboards',
        '/api/v1/achievements'
      ],
      phase4: [
        '/api/store',
        '/api/v1/store',
        '/api/admin/store',
        '/api/webhooks',
        '/api/forum', // NEW
        '/api/v1/forum' // NEW
      ],
      legacy: [
        '/api/olive-branches',
        '/api/registration',
        '/api/id-cards'
      ],
      system: [
        '/health',
        '/api',
        '/api/status/features'
      ]
    },
    timestamp: new Date().toISOString(),
    requestId: res.locals.requestId
  });
});

// Enhanced error handler (must be last middleware)
app.use(errorHandler);

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
  console.log(`${signal} received, shutting down gracefully`);
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const server = app.listen(PORT, () => {
  console.log(`
🌿 Galway Research Institute API Server Started
📍 Environment: ${process.env.NODE_ENV || 'development'}
🌐 Server running on port ${PORT}
🔗 Health check: http://localhost:${PORT}/health
📚 API documentation: http://localhost:${PORT}/api
🎯 Feature status: http://localhost:${PORT}/api/status/features
⏰ Started at: ${new Date().toISOString()}

✅ Phase 1-4 Implementation Complete:
🔐 JWT Authentication with refresh tokens
👥 Enhanced user management with status tracking
🔍 Advanced search with real-time suggestions
🎒 Complete inventory management system
🏆 Multi-category leaderboard system
🎯 Achievement system with progress tracking & rewards
🛍️ Complete E-Commerce Store with Stripe integration
💳 Secure payment processing (CAD currency)
📦 Order management and fulfillment tracking
🏷️ Coupon and discount system
📱 Digital item delivery system
📊 Admin dashboard with sales analytics
🔗 Webhook handling for payment events
💬 Complete Forum System with content moderation
📝 Thread creation, replies, and upvote system
⭐ Study verification and role promotion system
🛡️ Auto-moderation with manual review queue
📎 File attachment support (images, documents, archives)
🌿 Original olive branch system (maintained)
🆔 ID card generation system (maintained)

🚀 Ready for Phase 5: Advanced Features & Scaling

📋 Quick Test Commands:
curl http://localhost:${PORT}/api/store/categories
curl http://localhost:${PORT}/api/store/items
curl http://localhost:${PORT}/api/forum/categories
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:${PORT}/api/store/cart
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:${PORT}/api/forum/categories

🛍️ E-Commerce Features Available:
• Store categories and items (physical & digital)
• Shopping cart management
• Stripe checkout integration
• Order tracking and history
• Inventory management with variants
• Coupon system with usage limits
• Admin dashboard for store management
• Digital item delivery system
• Webhook processing for payments
• Sales analytics and reporting

💬 Forum Features Available:
• Forum categories (General, Study, Trading, Support)
• Thread creation with URL-friendly slugs
• Post replies with character limits (5000/1200)
• Content moderation and auto-flagging
• File attachments (images, documents, archives)
• Study verification with star system
• Role-based permissions and post limits
• Auto-lock threads after 15 days inactivity
• Upvote system and user reputation
• Moderation tools for admins/moderators
`);
});

module.exports = app;