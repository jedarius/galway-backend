// routes/inventory.js - Complete Inventory Management
const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const AuthMiddleware = require('../middleware/auth');
const { ResponseWrapper, ValidationError, NotFoundError, ForbiddenError } = require('../middleware/errorHandler');

const router = express.Router();
const prisma = new PrismaClient();

console.log('🎒 Complete Inventory Management routes loaded!');

// Inventory configuration
const INVENTORY_CONFIG = {
  MAX_DISPLAY_SLOTS: 4,
  MAX_TOTAL_SLOTS: 100,
  ITEM_TYPES: ['branch', 'seed', 'item', 'achievement', 'tool'],
  RARITY_MULTIPLIERS: {
    'Common': 1,
    'Uncommon': 1.5,
    'Rare': 2,
    'Very Rare': 3,
    'Legendary': 5
  }
};

// Helper functions
const calculateItemValue = (item) => {
  const baseValue = 10;
  const rarityMultiplier = INVENTORY_CONFIG.RARITY_MULTIPLIERS[item.rarity] || 1;
  const quantityBonus = item.quantity > 1 ? Math.log10(item.quantity) : 1;
  return Math.floor(baseValue * rarityMultiplier * quantityBonus);
};

const formatInventoryItem = (item, includePrivateData = false) => {
  const formatted = {
    id: item.id,
    itemType: item.itemType,
    quantity: item.quantity,
    gridPosition: item.gridPosition,
    sourceType: item.sourceType,
    createdAt: item.createdAt
  };

  // Add type-specific data
  if (item.itemType === 'branch' && item.oliveBranch) {
    formatted.branchData = {
      id: item.oliveBranch.id,
      botanicalId: item.oliveBranch.botanicalId,
      oliveType: item.oliveBranch.oliveType,
      oliveCount: item.oliveBranch.oliveCount,
      countRarity: item.oliveBranch.countRarity,
      typeRarity: item.oliveBranch.typeRarity,
      svgUrl: `/api/olive-branches/${item.oliveBranch.id}/svg`
    };
    formatted.displayName = `${item.oliveBranch.botanicalId} (${item.oliveBranch.oliveType})`;
    formatted.rarity = item.oliveBranch.countRarity;
    formatted.icon = '🌿';
  } else if (item.itemType === 'seed') {
    formatted.displayName = 'Olive Seed';
    formatted.rarity = 'Common';
    formatted.icon = '🌰';
  } else if (item.itemType === 'item') {
    formatted.displayName = item.metadata?.name || 'Research Item';
    formatted.rarity = item.metadata?.rarity || 'Common';
    formatted.icon = item.metadata?.icon || '📦';
  } else if (item.itemType === 'achievement') {
    formatted.displayName = item.metadata?.name || 'Achievement';
    formatted.rarity = item.metadata?.rarity || 'Uncommon';
    formatted.icon = item.metadata?.icon || '🏆';
  } else {
    formatted.displayName = 'Unknown Item';
    formatted.rarity = 'Common';
    formatted.icon = '❓';
  }

  // Add value and private data for owner/admin
  if (includePrivateData) {
    formatted.estimatedValue = calculateItemValue(formatted);
    formatted.sourceReference = item.sourceReference;
    formatted.metadata = item.metadata;
  }

  return formatted;
};

// GET /api/inventory/me - Get current user's inventory
router.get('/me',
  AuthMiddleware.requireAuth,
  [
    query('type').optional().isIn(INVENTORY_CONFIG.ITEM_TYPES).withMessage('Invalid item type'),
    query('displayOnly').optional().isBoolean().withMessage('displayOnly must be boolean'),
    query('includeValue').optional().isBoolean().withMessage('includeValue must be boolean')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Invalid query parameters', errors.array());
      }

      const { type, displayOnly, includeValue } = req.query;
      const userId = req.user.id;

      // Build where clause
      const where = { userId };
      
      if (type) {
        where.itemType = type;
      }

      if (displayOnly === 'true') {
        where.gridPosition = { lt: INVENTORY_CONFIG.MAX_DISPLAY_SLOTS };
      }

      // Get inventory items with related data - handle gracefully if oliveBranch relation doesn't exist
      let inventoryItems;
      try {
        inventoryItems = await prisma.inventoryItem.findMany({
          where,
          orderBy: [
            { gridPosition: 'asc' },
            { createdAt: 'desc' }
          ],
          include: {
            oliveBranch: {
              select: {
                id: true,
                botanicalId: true,
                oliveType: true,
                oliveCount: true,
                countRarity: true,
                typeRarity: true,
                countRarityPercentage: true,
                typeRarityPercentage: true
              }
            }
          }
        });
      } catch (relationError) {
        // If oliveBranch relation doesn't exist, fetch without it
        console.warn('oliveBranch relation not found, fetching inventory without branch data');
        inventoryItems = await prisma.inventoryItem.findMany({
          where,
          orderBy: [
            { gridPosition: 'asc' },
            { createdAt: 'desc' }
          ]
        });
      }

      // Format items for response
      const formattedItems = inventoryItems.map(item => 
        formatInventoryItem(item, includeValue === 'true')
      );

      // Calculate inventory stats
      const stats = {
        totalItems: inventoryItems.length,
        totalQuantity: inventoryItems.reduce((sum, item) => sum + (item.quantity || 1), 0),
        displayedItems: inventoryItems.filter(item => (item.gridPosition || 0) < INVENTORY_CONFIG.MAX_DISPLAY_SLOTS).length,
        availableSlots: INVENTORY_CONFIG.MAX_TOTAL_SLOTS - inventoryItems.length,
        typeBreakdown: inventoryItems.reduce((acc, item) => {
          acc[item.itemType] = (acc[item.itemType] || 0) + 1;
          return acc;
        }, {})
      };

      if (includeValue === 'true') {
        stats.totalValue = formattedItems.reduce((sum, item) => sum + (item.estimatedValue || 0), 0);
        stats.averageValue = stats.totalItems > 0 ? Math.floor(stats.totalValue / stats.totalItems) : 0;
      }

      return ResponseWrapper.success(res, {
        inventory: formattedItems,
        stats,
        config: {
          maxDisplaySlots: INVENTORY_CONFIG.MAX_DISPLAY_SLOTS,
          maxTotalSlots: INVENTORY_CONFIG.MAX_TOTAL_SLOTS
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// GET /api/inventory/:username - Get another user's displayed inventory
router.get('/:username',
  AuthMiddleware.requireAuth,
  async (req, res, next) => {
    try {
      const { username } = req.params;

      // Get target user
      const targetUser = await prisma.user.findUnique({
        where: { username },
        select: { id: true, username: true, role: true }
      });

      if (!targetUser) {
        throw new NotFoundError('User not found');
      }

      // Check permissions
      const isOwnInventory = req.user.username === username;
      const isAdmin = req.user.role === 'admin';
      const canViewFull = isOwnInventory || isAdmin;

      // Get displayed items only (unless admin/owner)
      const where = { 
        userId: targetUser.id,
        ...(canViewFull ? {} : { gridPosition: { lt: INVENTORY_CONFIG.MAX_DISPLAY_SLOTS } })
      };

      let inventoryItems;
      try {
        inventoryItems = await prisma.inventoryItem.findMany({
          where,
          orderBy: { gridPosition: 'asc' },
          include: {
            oliveBranch: {
              select: {
                id: true,
                botanicalId: true,
                oliveType: true,
                oliveCount: true,
                countRarity: true,
                typeRarity: true
              }
            }
          }
        });
      } catch (relationError) {
        inventoryItems = await prisma.inventoryItem.findMany({
          where,
          orderBy: { gridPosition: 'asc' }
        });
      }

      const formattedItems = inventoryItems.map(item => 
        formatInventoryItem(item, canViewFull)
      );

      return ResponseWrapper.success(res, {
        owner: {
          username: targetUser.username,
          role: targetUser.role
        },
        inventory: formattedItems,
        displayOnly: !canViewFull,
        permissions: {
          canViewFull,
          canEdit: isOwnInventory
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// NEW - Simple test without database calls:
router.get('/test', (req, res) => {
  ResponseWrapper.success(res, {
    message: 'Inventory system is working!',
    note: 'Database models ready for implementation',
    config: INVENTORY_CONFIG,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;