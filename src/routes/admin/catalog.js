// src/routes/admin/catalog.js
// Admin Catalog Management Routes
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { body, validationResult, query } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

console.log('🔧 Admin Catalog Management routes loaded successfully!');

// Apply admin authentication to all routes
router.use(requireAuth);
router.use(requireRole(['admin', 'moderator']));

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

// =============================================
// ADMIN DASHBOARD OVERVIEW
// =============================================

// GET /api/admin/catalog/dashboard - Admin catalog overview
router.get('/dashboard', async (req, res, next) => {
  try {
    const [
      totalItems,
      activeItems,
      totalOrders,
      pendingOrders,
      totalRevenue,
      marketplaceListings,
      activeBoosts
    ] = await Promise.all([
      prisma.catalogItem.count(),
      prisma.catalogItem.count({ where: { isActive: true } }),
      prisma.order.count(),
      prisma.order.count({ where: { status: 'pending' } }),
      prisma.order.aggregate({
        where: { status: { in: ['delivered', 'shipped'] } },
        _sum: { totalCents: true }
      }),
      prisma.branchListing.count({ where: { status: 'active' } }),
      prisma.generationBoost.count({ 
        where: { 
          isActive: true,
          startTime: { lte: new Date() },
          endTime: { gte: new Date() }
        } 
      })
    ]);

    // Get recent activity
    const recentOrders = await prisma.order.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { username: true } },
        items: { take: 1 }
      }
    });

    const recentListings = await prisma.branchListing.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        seller: { select: { username: true } },
        branch: { select: { botanicalId: true, oliveType: true } }
      }
    });

    // Category breakdown
    const itemsByCategory = await prisma.catalogItem.groupBy({
      by: ['itemType'],
      where: { isActive: true },
      _count: { itemType: true }
    });

    res.json({
      overview: {
        totalItems,
        activeItems,
        totalOrders,
        pendingOrders,
        totalRevenue: totalRevenue._sum.totalCents || 0,
        marketplaceListings,
        activeBoosts
      },
      categoryBreakdown: itemsByCategory.map(item => ({
        type: item.itemType,
        count: item._count.itemType
      })),
      recentActivity: {
        orders: recentOrders.map(order => ({
          id: order.id,
          orderNumber: order.orderNumber,
          customer: order.user.username,
          total: `$${(order.totalCents / 100).toFixed(2)}`,
          status: order.status,
          createdAt: order.createdAt
        })),
        listings: recentListings.map(listing => ({
          id: listing.id,
          seller: listing.seller.username,
          branch: listing.branch?.botanicalId || 'Bundle',
          price: `$${(listing.priceCents / 100).toFixed(2)}`,
          createdAt: listing.createdAt
        }))
      }
    });

  } catch (error) {
    console.error('🔴 Error fetching admin dashboard:', error);
    next(error);
  }
});

// =============================================
// CATALOG ITEM MANAGEMENT
// =============================================

// GET /api/admin/catalog/items - List all catalog items
router.get('/items', [
  query('type').optional().isIn(['seed', 'physical_item', 'digital_collectible']),
  query('active').optional().isBoolean(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], async (req, res, next) => {
  try {
    const {
      type,
      active,
      page = 1,
      limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    if (type) where.itemType = type;
    if (active !== undefined) where.isActive = active === 'true';

    const [items, total] = await Promise.all([
      prisma.catalogItem.findMany({
        where,
        include: {
          seedDetails: true,
          physicalDetails: true,
          digitalDetails: true,
          _count: {
            select: {
              orderItems: true,
              cartItems: true
            }
          }
        },
        orderBy: [
          { isFeatured: 'desc' },
          { sortOrder: 'asc' },
          { createdAt: 'desc' }
        ],
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.catalogItem.count({ where })
    ]);

    const itemsWithStats = items.map(item => ({
      ...item,
      formattedPrice: `$${(item.priceCents / 100).toFixed(2)}`,
      totalSales: item._count.orderItems,
      inCarts: item._count.cartItems,
      typeSpecific: item.seedDetails || item.physicalDetails || item.digitalDetails
    }));

    res.json({
      items: itemsWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('🔴 Error fetching admin catalog items:', error);
    next(error);
  }
});

// POST /api/admin/catalog/items - Create new catalog item
router.post('/items', [
  body('name').isLength({ min: 1, max: 200 }).withMessage('Name required (1-200 chars)'),
  body('description').isLength({ min: 1, max: 2000 }).withMessage('Description required'),
  body('itemType').isIn(['seed', 'physical_item', 'digital_collectible']).withMessage('Valid item type required'),
  body('priceCents').isInt({ min: 0 }).withMessage('Valid price required'),
  body('stockQuantity').optional().isInt({ min: 0 }),
  body('isActive').optional().isBoolean(),
  body('isFeatured').optional().isBoolean(),
  body('imageUrl').optional().isURL(),
  body('typeSpecific').isObject().withMessage('Type-specific data required')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Invalid item data', errors.array());
    }

    const {
      name,
      description,
      itemType,
      priceCents,
      stockQuantity,
      isActive = true,
      isFeatured = false,
      imageUrl,
      typeSpecific,
      sortOrder = 0
    } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      // Create main catalog item
      const item = await tx.catalogItem.create({
        data: {
          name,
          description,
          itemType,
          priceCents,
          stockQuantity,
          isActive,
          isFeatured,
          imageUrl,
          sortOrder
        }
      });

      // Create type-specific details
      if (itemType === 'seed') {
        await tx.seedCatalogItem.create({
          data: {
            catalogItemId: item.id,
            category: typeSpecific.category,
            rarityBoostPercentage: typeSpecific.rarityBoostPercentage || 0,
            specialEffects: typeSpecific.specialEffects,
            isBoostOnly: typeSpecific.isBoostOnly || false,
            generationLimit: typeSpecific.generationLimit
          }
        });
      } else if (itemType === 'physical_item') {
        await tx.physicalCatalogItem.create({
          data: {
            catalogItemId: item.id,
            category: typeSpecific.category,
            sku: typeSpecific.sku,
            weight: typeSpecific.weight,
            dimensions: typeSpecific.dimensions,
            requiresShipping: typeSpecific.requiresShipping !== false,
            shippingWeightGrams: typeSpecific.shippingWeightGrams,
            shippingClass: typeSpecific.shippingClass,
            hasVariants: typeSpecific.hasVariants || false,
            variants: typeSpecific.variants
          }
        });
      } else if (itemType === 'digital_collectible') {
        await tx.digitalCatalogItem.create({
          data: {
            catalogItemId: item.id,
            collectibleType: typeSpecific.collectibleType,
            themeData: typeSpecific.themeData,
            badgeIcon: typeSpecific.badgeIcon,
            badgeColor: typeSpecific.badgeColor,
            slotsAdded: typeSpecific.slotsAdded,
            boostType: typeSpecific.boostType,
            boostDurationHours: typeSpecific.boostDurationHours,
            boostMultiplier: typeSpecific.boostMultiplier
          }
        });
      }

      return item;
    });

    console.log('🟢 Admin created catalog item:', result.id);

    res.status(201).json({
      message: 'Catalog item created successfully',
      item: {
        id: result.id,
        name: result.name,
        type: result.itemType,
        price: `$${(result.priceCents / 100).toFixed(2)}`
      }
    });

  } catch (error) {
    console.error('🔴 Error creating catalog item:', error);
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

// PUT /api/admin/catalog/items/:id - Update catalog item
router.put('/items/:id', [
  body('name').optional().isLength({ min: 1, max: 200 }),
  body('description').optional().isLength({ min: 1, max: 2000 }),
  body('priceCents').optional().isInt({ min: 0 }),
  body('stockQuantity').optional().isInt({ min: 0 }),
  body('isActive').optional().isBoolean(),
  body('isFeatured').optional().isBoolean(),
  body('sortOrder').optional().isInt(),
  body('typeSpecific').optional().isObject()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Invalid update data', errors.array());
    }

    const itemId = parseInt(req.params.id);
    if (isNaN(itemId)) {
      throw new ValidationError('Invalid item ID');
    }

    const {
      name,
      description,
      priceCents,
      stockQuantity,
      isActive,
      isFeatured,
      sortOrder,
      imageUrl,
      typeSpecific
    } = req.body;

    // Check if item exists
    const existingItem = await prisma.catalogItem.findUnique({
      where: { id: itemId },
      include: {
        seedDetails: true,
        physicalDetails: true,
        digitalDetails: true
      }
    });

    if (!existingItem) {
      throw new NotFoundError('Catalog item not found');
    }

    const result = await prisma.$transaction(async (tx) => {
      // Update main item
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (priceCents !== undefined) updateData.priceCents = priceCents;
      if (stockQuantity !== undefined) updateData.stockQuantity = stockQuantity;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (isFeatured !== undefined) updateData.isFeatured = isFeatured;
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
      if (imageUrl !== undefined) updateData.imageUrl = imageUrl;

      const updatedItem = await tx.catalogItem.update({
        where: { id: itemId },
        data: updateData
      });

      // Update type-specific details if provided
      if (typeSpecific) {
        if (existingItem.itemType === 'seed' && existingItem.seedDetails) {
          await tx.seedCatalogItem.update({
            where: { catalogItemId: itemId },
            data: {
              category: typeSpecific.category || existingItem.seedDetails.category,
              rarityBoostPercentage: typeSpecific.rarityBoostPercentage ?? existingItem.seedDetails.rarityBoostPercentage,
              specialEffects: typeSpecific.specialEffects ?? existingItem.seedDetails.specialEffects,
              isBoostOnly: typeSpecific.isBoostOnly ?? existingItem.seedDetails.isBoostOnly,
              generationLimit: typeSpecific.generationLimit ?? existingItem.seedDetails.generationLimit
            }
          });
        } else if (existingItem.itemType === 'physical_item' && existingItem.physicalDetails) {
          await tx.physicalCatalogItem.update({
            where: { catalogItemId: itemId },
            data: {
              category: typeSpecific.category || existingItem.physicalDetails.category,
              sku: typeSpecific.sku ?? existingItem.physicalDetails.sku,
              weight: typeSpecific.weight ?? existingItem.physicalDetails.weight,
              dimensions: typeSpecific.dimensions ?? existingItem.physicalDetails.dimensions,
              requiresShipping: typeSpecific.requiresShipping ?? existingItem.physicalDetails.requiresShipping,
              shippingWeightGrams: typeSpecific.shippingWeightGrams ?? existingItem.physicalDetails.shippingWeightGrams,
              shippingClass: typeSpecific.shippingClass ?? existingItem.physicalDetails.shippingClass,
              hasVariants: typeSpecific.hasVariants ?? existingItem.physicalDetails.hasVariants,
              variants: typeSpecific.variants ?? existingItem.physicalDetails.variants
            }
          });
        } else if (existingItem.itemType === 'digital_collectible' && existingItem.digitalDetails) {
          await tx.digitalCatalogItem.update({
            where: { catalogItemId: itemId },
            data: {
              collectibleType: typeSpecific.collectibleType || existingItem.digitalDetails.collectibleType,
              themeData: typeSpecific.themeData ?? existingItem.digitalDetails.themeData,
              badgeIcon: typeSpecific.badgeIcon ?? existingItem.digitalDetails.badgeIcon,
              badgeColor: typeSpecific.badgeColor ?? existingItem.digitalDetails.badgeColor,
              slotsAdded: typeSpecific.slotsAdded ?? existingItem.digitalDetails.slotsAdded,
              boostType: typeSpecific.boostType ?? existingItem.digitalDetails.boostType,
              boostDurationHours: typeSpecific.boostDurationHours ?? existingItem.digitalDetails.boostDurationHours,
              boostMultiplier: typeSpecific.boostMultiplier ?? existingItem.digitalDetails.boostMultiplier
            }
          });
        }
      }

      return updatedItem;
    });

    console.log('🟢 Admin updated catalog item:', itemId);

    res.json({
      message: 'Catalog item updated successfully',
      item: {
        id: result.id,
        name: result.name,
        price: `${(result.priceCents / 100).toFixed(2)}`,
        isActive: result.isActive
      }
    });

  } catch (error) {
    console.error('🔴 Error updating catalog item:', error);
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

// DELETE /api/admin/catalog/items/:id - Delete catalog item
router.delete('/items/:id', async (req, res, next) => {
  try {
    const itemId = parseInt(req.params.id);
    if (isNaN(itemId)) {
      throw new ValidationError('Invalid item ID');
    }

    // Check if item has orders
    const orderCount = await prisma.orderItem.count({
      where: { catalogItemId: itemId }
    });

    if (orderCount > 0) {
      // Don't delete items with orders, just deactivate
      await prisma.catalogItem.update({
        where: { id: itemId },
        data: { isActive: false }
      });

      return res.json({
        message: 'Item deactivated (has existing orders)',
        deactivated: true
      });
    }

    // Safe to delete
    await prisma.catalogItem.delete({
      where: { id: itemId }
    });

    console.log('🟢 Admin deleted catalog item:', itemId);

    res.json({
      message: 'Catalog item deleted successfully',
      deleted: true
    });

  } catch (error) {
    console.error('🔴 Error deleting catalog item:', error);
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
// GENERATION BOOST MANAGEMENT
// =============================================

// GET /api/admin/catalog/boosts - List generation boosts
router.get('/boosts', async (req, res, next) => {
  try {
    const boosts = await prisma.generationBoost.findMany({
      include: {
        _count: {
          select: { userBoosts: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const boostsWithStats = boosts.map(boost => ({
      ...boost,
      usersParticipating: boost._count.userBoosts,
      isCurrentlyActive: boost.isActive && 
        new Date() >= boost.startTime && 
        new Date() <= boost.endTime,
      duration: Math.round((boost.endTime - boost.startTime) / (1000 * 60 * 60)) // hours
    }));

    res.json({ boosts: boostsWithStats });

  } catch (error) {
    console.error('🔴 Error fetching generation boosts:', error);
    next(error);
  }
});

// POST /api/admin/catalog/boosts - Create generation boost
router.post('/boosts', [
  body('name').isLength({ min: 1, max: 100 }).withMessage('Name required'),
  body('description').isLength({ min: 1, max: 1000 }).withMessage('Description required'),
  body('boostType').isIn(['rarity_increase', 'seasonal_colors', 'special_event', 'double_olives']),
  body('rarityMultiplier').isFloat({ min: 1.0, max: 5.0 }).withMessage('Valid multiplier required'),
  body('startTime').isISO8601().withMessage('Valid start time required'),
  body('endTime').isISO8601().withMessage('Valid end time required'),
  body('maxUsesPerUser').optional().isInt({ min: 1 })
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Invalid boost data', errors.array());
    }

    const {
      name,
      description,
      boostType,
      rarityMultiplier,
      startTime,
      endTime,
      maxUsesPerUser,
      colorPalettes
    } = req.body;

    if (new Date(endTime) <= new Date(startTime)) {
      throw new ValidationError('End time must be after start time');
    }

    const boost = await prisma.generationBoost.create({
      data: {
        name,
        description,
        boostType,
        rarityMultiplier,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        maxUsesPerUser,
        colorPalettes,
        isActive: true
      }
    });

    console.log('🟢 Admin created generation boost:', boost.id);

    res.status(201).json({
      message: 'Generation boost created successfully',
      boost: {
        id: boost.id,
        name: boost.name,
        type: boost.boostType,
        multiplier: boost.rarityMultiplier,
        startTime: boost.startTime,
        endTime: boost.endTime
      }
    });

  } catch (error) {
    console.error('🔴 Error creating generation boost:', error);
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

// PUT /api/admin/catalog/boosts/:id/toggle - Activate/deactivate boost
router.put('/boosts/:id/toggle', async (req, res, next) => {
  try {
    const boostId = parseInt(req.params.id);
    if (isNaN(boostId)) {
      throw new ValidationError('Invalid boost ID');
    }

    const boost = await prisma.generationBoost.findUnique({
      where: { id: boostId }
    });

    if (!boost) {
      throw new NotFoundError('Generation boost not found');
    }

    const updatedBoost = await prisma.generationBoost.update({
      where: { id: boostId },
      data: { isActive: !boost.isActive }
    });

    console.log('🟢 Admin toggled boost:', boostId, 'to', updatedBoost.isActive);

    res.json({
      message: `Boost ${updatedBoost.isActive ? 'activated' : 'deactivated'} successfully`,
      boost: {
        id: updatedBoost.id,
        name: updatedBoost.name,
        isActive: updatedBoost.isActive
      }
    });

  } catch (error) {
    console.error('🔴 Error toggling boost:', error);
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
// MARKETPLACE OVERSIGHT
// =============================================

// GET /api/admin/catalog/marketplace - Oversee marketplace listings
router.get('/marketplace', [
  query('status').optional().isIn(['draft', 'active', 'sold', 'expired', 'cancelled']),
  query('flagged').optional().isBoolean(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], async (req, res, next) => {
  try {
    const {
      status,
      flagged,
      page = 1,
      limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    if (status) where.status = status;
    // Add flagged logic when you implement reporting system

    const [listings, total] = await Promise.all([
      prisma.branchListing.findMany({
        where,
        include: {
          seller: {
            select: {
              id: true,
              username: true,
              role: true,
              email: true
            }
          },
          branch: {
            select: {
              id: true,
              botanicalId: true,
              oliveType: true,
              countRarity: true,
              typeRarity: true
            }
          },
          bundleBranches: {
            include: {
              branch: {
                select: {
                  botanicalId: true,
                  oliveType: true
                }
              }
            }
          },
          purchases: {
            include: {
              buyer: {
                select: { username: true }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.branchListing.count({ where })
    ]);

    const listingsWithStats = listings.map(listing => ({
      ...listing,
      formattedPrice: `${(listing.priceCents / 100).toFixed(2)}`,
      bundleSize: listing.isBundle ? listing.bundleBranches.length : 1,
      soldTo: listing.purchases[0]?.buyer?.username,
      daysListed: Math.floor((new Date() - listing.listedAt) / (1000 * 60 * 60 * 24)),
      needsReview: false // Add your flagging logic here
    }));

    res.json({
      listings: listingsWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      },
      stats: {
        totalListings: total,
        averagePrice: listings.length > 0 
          ? `${(listings.reduce((sum, l) => sum + l.priceCents, 0) / listings.length / 100).toFixed(2)}`
          : '$0.00'
      }
    });

  } catch (error) {
    console.error('🔴 Error fetching marketplace oversight:', error);
    next(error);
  }
});

// PUT /api/admin/catalog/marketplace/:id/moderate - Moderate listing
router.put('/marketplace/:id/moderate', requireRole(['admin']), [
  body('action').isIn(['approve', 'remove', 'flag']).withMessage('Valid action required'),
  body('reason').optional().isLength({ max: 500 }).withMessage('Reason too long')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Invalid moderation data', errors.array());
    }

    const listingId = parseInt(req.params.id);
    const { action, reason } = req.body;

    if (isNaN(listingId)) {
      throw new ValidationError('Invalid listing ID');
    }

    const listing = await prisma.branchListing.findUnique({
      where: { id: listingId },
      include: { seller: { select: { username: true } } }
    });

    if (!listing) {
      throw new NotFoundError('Listing not found');
    }

    let updateData = {};
    let message = '';

    switch (action) {
      case 'approve':
        updateData = { status: 'active' };
        message = 'Listing approved';
        break;
      case 'remove':
        updateData = { status: 'cancelled' };
        message = 'Listing removed';
        break;
      case 'flag':
        // Add flagging logic
        message = 'Listing flagged for review';
        break;
    }

    await prisma.branchListing.update({
      where: { id: listingId },
      data: updateData
    });

    // Log admin action
    await prisma.adminLog.create({
      data: {
        adminId: req.user.id,
        action: `marketplace_${action}`,
        targetType: 'branch_listing',
        targetId: listingId,
        notes: reason || `${action} listing #${listingId} by ${listing.seller.username}`
      }
    });

    console.log('🟢 Admin moderated listing:', listingId, action);

    res.json({
      message,
      listing: {
        id: listingId,
        status: updateData.status,
        action: action
      }
    });

  } catch (error) {
    console.error('🔴 Error moderating listing:', error);
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
// ORDER MANAGEMENT
// =============================================

// GET /api/admin/catalog/orders - List all orders
router.get('/orders', [
  query('status').optional().isIn(['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
], async (req, res, next) => {
  try {
    const {
      status,
      page = 1,
      limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    if (status) where.status = status;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              username: true,
              email: true
            }
          },
          items: {
            include: {
              catalogItem: {
                select: {
                  name: true,
                  itemType: true
                }
              }
            }
          },
          payment: {
            select: {
              id: true,
              status: true,
              stripePaymentIntentId: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.order.count({ where })
    ]);

    const ordersWithDetails = orders.map(order => ({
      ...order,
      formattedTotal: `${(order.totalCents / 100).toFixed(2)}`,
      itemCount: order.items.length,
      hasPhysical: order.items.some(item => item.catalogItem?.itemType === 'physical_item'),
      hasDigital: order.items.some(item => item.catalogItem?.itemType !== 'physical_item'),
      daysSinceOrder: Math.floor((new Date() - order.createdAt) / (1000 * 60 * 60 * 24))
    }));

    res.json({
      orders: ordersWithDetails,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('🔴 Error fetching orders:', error);
    next(error);
  }
});

// PUT /api/admin/catalog/orders/:id/status - Update order status
router.put('/orders/:id/status', [
  body('status').isIn(['pending', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded']),
  body('trackingNumber').optional().isLength({ max: 100 }),
  body('notes').optional().isLength({ max: 500 })
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Invalid status update', errors.array());
    }

    const orderId = parseInt(req.params.id);
    const { status, trackingNumber, notes } = req.body;

    if (isNaN(orderId)) {
      throw new ValidationError('Invalid order ID');
    }

    const updateData = { status };
    if (trackingNumber) updateData.trackingNumber = trackingNumber;
    if (status === 'shipped') updateData.shippedAt = new Date();
    if (status === 'delivered') updateData.deliveredAt = new Date();

    const order = await prisma.order.update({
      where: { id: orderId },
      data: updateData,
      include: {
        user: { select: { username: true } }
      }
    });

    // Log admin action
    await prisma.adminLog.create({
      data: {
        adminId: req.user.id,
        action: 'order_status_update',
        targetType: 'order',
        targetId: orderId,
        notes: notes || `Updated order #${order.orderNumber} to ${status}`
      }
    });

    console.log('🟢 Admin updated order status:', orderId, 'to', status);

    res.json({
      message: 'Order status updated successfully',
      order: {
        id: orderId,
        orderNumber: order.orderNumber,
        status: order.status,
        customer: order.user.username
      }
    });

  } catch (error) {
    console.error('🔴 Error updating order status:', error);
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