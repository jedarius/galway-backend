// src/routes/catalog.js
// Complete Catalog System Routes with Digital/Physical Tabs
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { body, validationResult, query } = require('express-validator');
const { requireAuth, requireRole, optionalAuth } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

console.log('🛒 Complete Catalog System routes loaded successfully!');

// Custom error classes
class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.statusCode = 400;
    this.code = 'VALIDATION_ERROR';
    this.details = details;
  }
}

class NotFoundError extends Error {
  constructor(message = 'Resource not found') {
    super(message);
    this.statusCode = 404;
    this.code = 'NOT_FOUND';
  }
}

class ForbiddenError extends Error {
  constructor(message = 'Access forbidden') {
    super(message);
    this.statusCode = 403;
    this.code = 'FORBIDDEN';
  }
}

// Helper function to calculate commission
const calculateCommission = (priceCents, commissionPercentage = 5.0) => {
  const commissionCents = Math.round(priceCents * (commissionPercentage / 100));
  const sellerEarnsCents = priceCents - commissionCents;
  return { commissionCents, sellerEarnsCents };
};

// =============================================
// DIGITAL CATALOG ROUTES
// =============================================

// GET /api/catalog/digital - Browse all digital items
router.get('/digital', optionalAuth, [
  query('category').optional().isIn(['seeds', 'branches', 'collectibles', 'themes', 'badges']),
  query('subcategory').optional(),
  query('sortBy').optional().isIn(['price', 'name', 'created', 'featured']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Invalid query parameters', errors.array());
    }

    const {
      category,
      subcategory,
      sortBy = 'featured',
      sortOrder = 'desc',
      page = 1,
      limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build where clause for digital items
    const where = {
      isActive: true,
      itemType: {
        in: ['seed', 'digital_collectible', 'profile_theme', 'badge', 'inventory_expansion', 'generation_boost']
      }
    };

    // Apply category filters
    if (category === 'seeds') {
      where.itemType = 'seed';
    } else if (category === 'collectibles') {
      where.itemType = {
        in: ['digital_collectible', 'profile_theme', 'badge', 'inventory_expansion']
      };
    }

    // Apply availability window
    const now = new Date();
    where.AND = [
      {
        OR: [
          { availableFrom: null },
          { availableFrom: { lte: now } }
        ]
      },
      {
        OR: [
          { availableUntil: null },
          { availableUntil: { gte: now } }
        ]
      }
    ];

    // Check for active generation boosts (affects premium seed availability)
    const activeBoosts = await prisma.generationBoost.findMany({
      where: {
        isActive: true,
        startTime: { lte: now },
        endTime: { gte: now }
      }
    });

    // If no active boosts, hide boost-only premium seeds
    if (activeBoosts.length === 0) {
      where.seedDetails = {
        OR: [
          { isBoostOnly: false },
          { isBoostOnly: null }
        ]
      };
    }

    // Build sort options
    let orderBy = { sortOrder: 'asc' };
    if (sortBy === 'price') {
      orderBy = { priceCents: sortOrder };
    } else if (sortBy === 'name') {
      orderBy = { name: sortOrder };
    } else if (sortBy === 'created') {
      orderBy = { createdAt: sortOrder };
    } else if (sortBy === 'featured') {
      orderBy = [{ isFeatured: 'desc' }, { sortOrder: 'asc' }];
    }

    // Get items with related data
    const [items, total] = await Promise.all([
      prisma.catalogItem.findMany({
        where,
        include: {
          seedDetails: true,
          digitalDetails: true,
          _count: {
            select: {
              orderItems: {
                where: {
                  order: {
                    status: { in: ['pending', 'processing', 'shipped', 'delivered'] }
                  }
                }
              }
            }
          }
        },
        orderBy,
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.catalogItem.count({ where })
    ]);

    // Add computed fields
    const itemsWithExtras = items.map(item => ({
      ...item,
      formattedPrice: `$${(item.priceCents / 100).toFixed(2)}`,
      isAvailable: item.stockQuantity === null || item.stockQuantity > 0,
      soldCount: item._count.orderItems,
      isSeed: item.itemType === 'seed',
      isCollectible: ['digital_collectible', 'profile_theme', 'badge', 'inventory_expansion'].includes(item.itemType),
      isBoostOnly: item.seedDetails?.isBoostOnly || false,
      canPurchase: req.user ? true : false // Guests can view but need to login to purchase
    }));

    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      items: itemsWithExtras,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      },
      filters: {
        category,
        subcategory,
        sortBy,
        sortOrder
      },
      activeBoosts: activeBoosts.map(boost => ({
        id: boost.id,
        name: boost.name,
        type: boost.boostType,
        endTime: boost.endTime
      })),
      categories: {
        seeds: {
          name: 'Seeds',
          count: await prisma.catalogItem.count({
            where: { ...where, itemType: 'seed' }
          })
        },
        collectibles: {
          name: 'Digital Collectibles',
          count: await prisma.catalogItem.count({
            where: {
              ...where,
              itemType: {
                in: ['digital_collectible', 'profile_theme', 'badge', 'inventory_expansion']
              }
            }
          })
        }
      }
    });

  } catch (error) {
    console.error('🔴 Error fetching digital catalog:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        details: error.details
      });
    }
    next(error);
  }
});

// GET /api/catalog/digital/seeds - Dedicated seeds endpoint
router.get('/digital/seeds', optionalAuth, [
  query('category').optional().isIn(['basic', 'premium', 'seasonal', 'vintage_2024', 'new_age_2025']),
  query('onlyAvailable').optional().isBoolean()
], async (req, res, next) => {
  try {
    const { category, onlyAvailable = 'true' } = req.query;

    const where = {
      isActive: true,
      itemType: 'seed',
      seedDetails: { isNot: null }
    };

    if (category) {
      where.seedDetails = { category };
    }

    // Check boost availability for premium seeds
    const now = new Date();
    const activeBoosts = await prisma.generationBoost.findMany({
      where: {
        isActive: true,
        startTime: { lte: now },
        endTime: { gte: now }
      }
    });

    if (onlyAvailable === 'true' && activeBoosts.length === 0) {
      // Hide boost-only seeds when no active boosts
      where.seedDetails = {
        ...where.seedDetails,
        isBoostOnly: false
      };
    }

    const seeds = await prisma.catalogItem.findMany({
      where,
      include: {
        seedDetails: true
      },
      orderBy: [
        { isFeatured: 'desc' },
        { seedDetails: { category: 'asc' } },
        { priceCents: 'asc' }
      ]
    });

    // Group by category
    const categorizedSeeds = {
      basic: [],
      premium: [],
      seasonal: [],
      vintage_2024: [],
      new_age_2025: []
    };

    seeds.forEach(seed => {
      const cat = seed.seedDetails.category;
      if (categorizedSeeds[cat]) {
        categorizedSeeds[cat].push({
          ...seed,
          formattedPrice: `$${(seed.priceCents / 100).toFixed(2)}`,
          isAvailable: !seed.seedDetails.isBoostOnly || activeBoosts.length > 0,
          needsBoost: seed.seedDetails.isBoostOnly && activeBoosts.length === 0,
          rarityBoost: seed.seedDetails.rarityBoostPercentage
        });
      }
    });

    res.json({
      categorizedSeeds,
      activeBoosts,
      seedInfo: {
        basic: {
          name: 'Basic Seeds',
          description: 'Standard olive branch generation with normal rarity rates',
          price: '$2.50',
          always_available: true
        },
        premium: {
          name: 'Premium Seeds',
          description: 'Enhanced rarity chances - only available during generation boosts',
          price: '$2.50',
          boost_only: true
        },
        seasonal: {
          name: 'Seasonal Seeds',
          description: 'Limited-time seeds with special color palettes and themes',
          price: '$10.00',
          limited_time: true
        },
        vintage_2024: {
          name: 'Vintage Collection (2024)',
          description: 'Original style branches documenting the early days',
          year: 2024
        },
        new_age_2025: {
          name: 'New Age Collection (2025)',
          description: 'Updated generation algorithms with modern aesthetics',
          year: 2025
        }
      }
    });

  } catch (error) {
    console.error('🔴 Error fetching seeds:', error);
    next(error);
  }
});

// =============================================
// USER MARKETPLACE ROUTES (Branches)
// =============================================

// GET /api/catalog/digital/branches - Browse user marketplace
router.get('/digital/branches', optionalAuth, [
  query('rarity').optional().isIn(['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary']),
  query('oliveType').optional(),
  query('priceMin').optional().isInt({ min: 0 }),
  query('priceMax').optional().isInt({ min: 0 }),
  query('sortBy').optional().isIn(['price', 'created', 'rarity']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('bundlesOnly').optional().isBoolean(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
], async (req, res, next) => {
  try {
    const {
      rarity,
      oliveType,
      priceMin,
      priceMax,
      sortBy = 'created',
      sortOrder = 'desc',
      bundlesOnly = 'false',
      page = 1,
      limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      status: 'active',
      expiresAt: { gt: new Date() }
    };

    // Bundle filter
    if (bundlesOnly === 'true') {
      where.isBundle = true;
    }

    // Price filters
    if (priceMin) where.priceCents = { gte: parseInt(priceMin) * 100 };
    if (priceMax) {
      where.priceCents = {
        ...where.priceCents,
        lte: parseInt(priceMax) * 100
      };
    }

    // Rarity and type filters (need to filter through branch relationship)
    const branchWhere = {};
    if (rarity) branchWhere.countRarity = rarity;
    if (oliveType) branchWhere.oliveType = { contains: oliveType, mode: 'insensitive' };

    if (Object.keys(branchWhere).length > 0) {
      where.OR = [
        { branch: branchWhere }, // Individual listings
        { 
          bundleBranches: {
            some: { branch: branchWhere }
          }
        } // Bundle listings containing matching branches
      ];
    }

    // Sort options
    let orderBy = { createdAt: sortOrder };
    if (sortBy === 'price') {
      orderBy = { priceCents: sortOrder };
    }

    const [listings, total] = await Promise.all([
      prisma.branchListing.findMany({
        where,
        include: {
          seller: {
            select: {
              id: true,
              username: true,
              role: true
            }
          },
          branch: {
            select: {
              id: true,
              botanicalId: true,
              oliveCount: true,
              oliveType: true,
              countRarity: true,
              typeRarity: true,
              countRarityPercentage: true,
              typeRarityPercentage: true,
              oliveColor: true,
              branchColor: true,
              leafColor: true
            }
          },
          bundleBranches: {
            include: {
              branch: {
                select: {
                  id: true,
                  botanicalId: true,
                  oliveCount: true,
                  oliveType: true,
                  countRarity: true,
                  typeRarity: true,
                  countRarityPercentage: true,
                  typeRarityPercentage: true,
                  oliveColor: true,
                  branchColor: true,
                  leafColor: true
                }
              }
            }
          }
        },
        orderBy,
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.branchListing.count({ where })
    ]);

    // Add computed fields
    const listingsWithExtras = listings.map(listing => {
      const { commissionCents, sellerEarnsCents } = calculateCommission(
        listing.priceCents,
        listing.commissionPercentage
      );

      return {
        ...listing,
        formattedPrice: `$${(listing.priceCents / 100).toFixed(2)}`,
        sellerEarns: `$${(sellerEarnsCents / 100).toFixed(2)}`,
        platformFee: `$${(commissionCents / 100).toFixed(2)}`,
        bundleSize: listing.isBundle ? listing.bundleBranches.length : 1,
        primaryBranch: listing.isBundle ? listing.bundleBranches[0]?.branch : listing.branch,
        canPurchase: req.user?.id !== listing.sellerId,
        svgUrl: listing.isBundle 
          ? `/api/olive-branches/${listing.bundleBranches[0]?.branch?.id}/svg`
          : `/api/olive-branches/${listing.branch?.id}/svg`
      };
    });

    const totalPages = Math.ceil(total / parseInt(limit));

    res.json({
      listings: listingsWithExtras,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages,
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      },
      filters: {
        rarity,
        oliveType,
        priceMin,
        priceMax,
        bundlesOnly,
        sortBy,
        sortOrder
      },
      marketplaceInfo: {
        totalListings: total,
        commission: '5%',
        minPrice: '$1.00',
        maxPrice: '$500.00'
      }
    });

  } catch (error) {
    console.error('🔴 Error fetching branch marketplace:', error);
    next(error);
  }
});

// POST /api/catalog/digital/branches/list - Create new branch listing
router.post('/digital/branches/list', requireAuth, [
  body('branchIds').isArray({ min: 1 }).withMessage('At least one branch required'),
  body('priceCents').isInt({ min: 100, max: 50000 }).withMessage('Price must be between $1.00 and $500.00'),
  body('title').isLength({ min: 3, max: 200 }).withMessage('Title must be 3-200 characters'),
  body('description').optional().isLength({ max: 1000 }).withMessage('Description max 1000 characters'),
  body('isBundle').optional().isBoolean()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Invalid listing data', errors.array());
    }

    const {
      branchIds,
      priceCents,
      title,
      description,
      isBundle = false
    } = req.body;

    // Validate user owns all branches
    const userBranches = await prisma.oliveBranch.findMany({
      where: {
        id: { in: branchIds },
        userId: req.user.id
      },
      include: {
        inventoryItems: true,
        branchListings: {
          where: {
            status: { in: ['active', 'draft'] }
          }
        }
      }
    });

    if (userBranches.length !== branchIds.length) {
      throw new ForbiddenError('You can only list branches you own');
    }

    // Check that branches aren\'t already listed
    const alreadyListed = userBranches.filter(branch => branch.branchListings.length > 0);
    if (alreadyListed.length > 0) {
      throw new ValidationError(`Some branches are already listed: ${alreadyListed.map(b => b.botanicalId).join(', ')}`);
    }

    // Check platform price limits
    const config = await prisma.siteConfig.findMany({
      where: {
        key: { in: ['marketplace_min_price', 'marketplace_max_price'] }
      }
    });

    const minPrice = config.find(c => c.key === 'marketplace_min_price')?.value || 100;
    const maxPrice = config.find(c => c.key === 'marketplace_max_price')?.value || 50000;

    if (priceCents < minPrice || priceCents > maxPrice) {
      throw new ValidationError(`Price must be between $${minPrice/100} and $${maxPrice/100}`);
    }

    // Create listing
    const result = await prisma.$transaction(async (tx) => {
      // Create the listing
      const listing = await tx.branchListing.create({
        data: {
          sellerId: req.user.id,
          branchId: isBundle ? null : branchIds[0],
          isBundle,
          priceCents,
          title,
          description,
          status: 'active',
          listedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          minPriceCents: minPrice,
          maxPriceCents: maxPrice
        }
      });

      // If bundle, create bundle associations
      if (isBundle && branchIds.length > 1) {
        await tx.branchListingBundle.createMany({
          data: branchIds.map(branchId => ({
            listingId: listing.id,
            branchId
          }))
        });
      }

      return listing;
    });

    console.log('🟢 Branch listing created:', result.id, 'by user:', req.user.id);

    res.status(201).json({
      message: 'Branch listing created successfully!',
      listing: {
        id: result.id,
        title: result.title,
        price: `$${(result.priceCents / 100).toFixed(2)}`,
        isBundle,
        branchCount: branchIds.length,
        status: result.status,
        expiresAt: result.expiresAt
      }
    });

  } catch (error) {
    console.error('🔴 Error creating branch listing:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        details: error.details
      });
    }
    next(error);
  }
});

// =============================================
// PHYSICAL CATALOG ROUTES
// =============================================

// GET /api/catalog/physical - Browse physical merchandise
router.get('/physical', optionalAuth, [
  query('category').optional().isIn(['apparel', 'accessories', 'collectibles', 'functional', 'premium_limited']),
  query('sortBy').optional().isIn(['price', 'name', 'created', 'featured']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('inStock').optional().isBoolean()
], async (req, res, next) => {
  try {
    const {
      category,
      sortBy = 'featured',
      sortOrder = 'desc',
      inStock = 'true'
    } = req.query;

    const where = {
      isActive: true,
      itemType: 'physical_item',
      physicalDetails: { isNot: null }
    };

    if (category) {
      where.physicalDetails = { category };
    }

    if (inStock === 'true') {
      where.OR = [
        { stockQuantity: null }, // Unlimited stock
        { stockQuantity: { gt: 0 } } // Has stock
      ];
    }

    // Build sort
    let orderBy = [{ isFeatured: 'desc' }, { sortOrder: 'asc' }];
    if (sortBy === 'price') {
      orderBy = { priceCents: sortOrder };
    } else if (sortBy === 'name') {
      orderBy = { name: sortOrder };
    } else if (sortBy === 'created') {
      orderBy = { createdAt: sortOrder };
    }

    const items = await prisma.catalogItem.findMany({
      where,
      include: {
        physicalDetails: true,
        _count: {
          select: {
            orderItems: {
              where: {
                order: {
                  status: { in: ['delivered'] }
                }
              }
            }
          }
        }
      },
      orderBy
    });

    // Group by category
    const categorizedItems = {
      apparel: [],
      accessories: [],
      collectibles: [],
      functional: [],
      premium_limited: []
    };

    items.forEach(item => {
      const cat = item.physicalDetails.category;
      if (categorizedItems[cat]) {
        categorizedItems[cat].push({
          ...item,
          formattedPrice: `$${(item.priceCents / 100).toFixed(2)}`,
          isInStock: item.stockQuantity === null || item.stockQuantity > 0,
          soldCount: item._count.orderItems,
          requiresShipping: item.physicalDetails.requiresShipping,
          hasVariants: item.physicalDetails.hasVariants
        });
      }
    });

    res.json({
      categorizedItems,
      categories: {
        apparel: {
          name: 'Apparel & Clothing',
          description: 'T-shirts, hoodies, and branded clothing',
          icon: '👕'
        },
        accessories: {
          name: 'Accessories',
          description: 'Pins, lanyards, and wearable items',
          icon: '📌'
        },
        collectibles: {
          name: 'Collectibles & Art',
          description: 'Patches, posters, and limited edition items',
          icon: '🎨'
        },
        functional: {
          name: 'Functional Items',
          description: 'Mugs, notebooks, and everyday use items',
          icon: '☕'
        },
        premium_limited: {
          name: 'Premium & Limited',
          description: 'Exclusive items and beta tester rewards',
          icon: '⭐'
        }
      },
      shippingInfo: {
        freeShippingOver: '$50.00',
        internationalShipping: true,
        estimatedDelivery: '5-7 business days'
      }
    });

  } catch (error) {
    console.error('🔴 Error fetching physical catalog:', error);
    next(error);
  }
});

// GET /api/catalog/physical/:id - Get detailed physical item info
router.get('/physical/:id', optionalAuth, async (req, res, next) => {
  try {
    const itemId = parseInt(req.params.id);
    if (isNaN(itemId)) {
      throw new ValidationError('Invalid item ID');
    }

    const item = await prisma.catalogItem.findFirst({
      where: {
        id: itemId,
        isActive: true,
        itemType: 'physical_item'
      },
      include: {
        physicalDetails: true
      }
    });

    if (!item) {
      throw new NotFoundError('Physical item not found');
    }

    res.json({
      item: {
        ...item,
        formattedPrice: `$${(item.priceCents / 100).toFixed(2)}`,
        isInStock: item.stockQuantity === null || item.stockQuantity > 0,
        requiresShipping: item.physicalDetails.requiresShipping,
        variants: item.physicalDetails.variants || [],
        shipping: {
          weight: item.physicalDetails.shippingWeightGrams,
          class: item.physicalDetails.shippingClass,
          dimensions: item.physicalDetails.dimensions
        }
      }
    });

  } catch (error) {
    console.error('🔴 Error fetching physical item:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code
      });
    }
    next(error);
  }
});

// =============================================
// CART & CHECKOUT ROUTES
// =============================================

// GET /api/catalog/cart - Get user's cart
router.get('/cart', requireAuth, async (req, res, next) => {
  try {
    let cart = await prisma.cart.findUnique({
      where: { userId: req.user.id },
      include: {
        items: {
          include: {
            catalogItem: {
              include: {
                seedDetails: true,
                physicalDetails: true,
                digitalDetails: true
              }
            },
            branchListing: {
              include: {
                branch: true,
                bundleBranches: {
                  include: { branch: true }
                },
                seller: {
                  select: { username: true }
                }
              }
            }
          }
        }
      }
    });

    if (!cart) {
      // Create empty cart
      cart = await prisma.cart.create({
        data: { userId: req.user.id },
        include: { items: [] }
      });
    }

    // Calculate totals
    let subtotalCents = 0;
    let shippingCents = 0;
    let hasPhysicalItems = false;

    const itemsWithDetails = cart.items.map(item => {
      const price = item.catalogItem?.priceCents || item.branchListing?.priceCents || 0;
      const itemTotal = price * item.quantity;
      subtotalCents += itemTotal;

      // Check if item requires shipping
      if (item.catalogItem?.physicalDetails?.requiresShipping) {
        hasPhysicalItems = true;
      }

      return {
        ...item,
        unitPrice: `$${(price / 100).toFixed(2)}`,
        totalPrice: `$${(itemTotal / 100).toFixed(2)}`,
        isPhysical: item.catalogItem?.itemType === 'physical_item',
        isMarketplace: !!item.branchListing
      };
    });

    // Calculate shipping for physical items
    if (hasPhysicalItems && subtotalCents < 5000) { // Free shipping over $50
      shippingCents = 500; // $5.00 standard shipping
    }

    const totalCents = subtotalCents + shippingCents;

    res.json({
      cart: {
        id: cart.id,
        items: itemsWithDetails,
        itemCount: cart.items.length,
        subtotal: `$${(subtotalCents / 100).toFixed(2)}`,
        shipping: `$${(shippingCents / 100).toFixed(2)}`,
        total: `$${(totalCents / 100).toFixed(2)}`,
        hasPhysicalItems,
        freeShippingEligible: subtotalCents >= 5000
      }
    });

  } catch (error) {
    console.error('🔴 Error fetching cart:', error);
    next(error);
  }
});

// POST /api/catalog/cart/add - Add item to cart
router.post('/cart/add', requireAuth, [
  body('catalogItemId').optional().isInt(),
  body('branchListingId').optional().isInt(),
  body('quantity').optional().isInt({ min: 1, max: 10 }),
  body('selectedVariant').optional().isObject()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Invalid cart data', errors.array());
    }

    const { catalogItemId, branchListingId, quantity = 1, selectedVariant } = req.body;

    if (!catalogItemId && !branchListingId) {
      throw new ValidationError('Either catalogItemId or branchListingId required');
    }

    // Get or create cart
    let cart = await prisma.cart.findUnique({
      where: { userId: req.user.id }
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId: req.user.id }
      });
    }

    let item = null;
    let priceAtTime = 0;

    if (catalogItemId) {
      // Adding catalog item
      item = await prisma.catalogItem.findFirst({
        where: {
          id: catalogItemId,
          isActive: true
        }
      });

      if (!item) {
        throw new NotFoundError('Catalog item not found');
      }

      priceAtTime = item.priceCents;

      // Check stock
      if (item.stockQuantity !== null && item.stockQuantity < quantity) {
        throw new ValidationError('Insufficient stock');
      }

    } else if (branchListingId) {
      // Adding marketplace item
      const listing = await prisma.branchListing.findFirst({
        where: {
          id: branchListingId,
          status: 'active',
          sellerId: { not: req.user.id } // Can't buy your own listing
        }
      });

      if (!listing) {
        throw new NotFoundError('Branch listing not found or unavailable');
      }

      priceAtTime = listing.priceCents;
    }

    // Add to cart
    const cartItem = await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        catalogItemId,
        branchListingId,
        quantity,
        priceAtTime,
        selectedVariant
      }
    });

    console.log('🟢 Item added to cart:', cartItem.id, 'for user:', req.user.id);

    res.status(201).json({
      message: 'Item added to cart successfully!',
      cartItem: {
        id: cartItem.id,
        quantity: cartItem.quantity,
        price: `$${(priceAtTime / 100).toFixed(2)}`
      }
    });

  } catch (error) {
    console.error('🔴 Error adding to cart:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        details: error.details
      });
    }
    next(error);
  }
});

module.exports = router;