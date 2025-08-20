// src/routes/oliveBranches.js
// Complete Olive Branch Generation and Management Routes
const express = require('express');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { generateOliveBranchSVG } = require('../services/oliveBranchGenerator');
const router = express.Router();
const prisma = new PrismaClient();

console.log('🌿 Complete Olive Branch routes loaded successfully!');

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

// Helper function to generate unique botanical ID
const generateBotanicalId = async () => {
  let botanicalId;
  let isUnique = false;
  
  while (!isUnique) {
    const prefix = 'OLV';
    const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    botanicalId = `${prefix}-${suffix}`;
    
    const existing = await prisma.oliveBranch.findUnique({
      where: { botanicalId },
    });
    isUnique = !existing;
  }
  return botanicalId;
};

// Helper function to calculate rarity (your exact system)
const calculateRarity = (oliveCount, oliveType) => {
  const countRarities = {
    1: { name: 'Common', percentage: 33 },
    2: { name: 'Common', percentage: 28 },
    3: { name: 'Uncommon', percentage: 19 },
    4: { name: 'Rare', percentage: 12 },
    5: { name: 'Very Rare', percentage: 8 }
  };
  
  const typeRarities = {
    'greenOlives': { name: 'Common', percentage: 30 },
    'blackOlives': { name: 'Common', percentage: 25 },
    'brownOlives': { name: 'Uncommon', percentage: 20 },
    'purpleOlives': { name: 'Rare', percentage: 15 },
    'ripeMixed': { name: 'Very Rare', percentage: 10 }
  };
  
  return {
    countRarity: countRarities[oliveCount].name,
    countRarityPercentage: countRarities[oliveCount].percentage,
    typeRarity: typeRarities[oliveType].name,
    typeRarityPercentage: typeRarities[oliveType].percentage
  };
};

// Helper function to calculate trading value
const calculateTradingValue = (branch) => {
  const rarityScores = {
    'Common': 1,
    'Uncommon': 2, 
    'Rare': 3,
    'Very Rare': 4,
    'Legendary': 5
  };
  
  const countScore = rarityScores[branch.countRarity] || 1;
  const typeScore = rarityScores[branch.typeRarity] || 1;
  const totalRarityScore = countScore + typeScore;
  
  return Math.floor(totalRarityScore * 1.5) + Math.floor(branch.oliveCount * 0.5);
};

// Helper function to generate olive branch data (your exact algorithm)
const generateOliveBranchData = () => {
  const seedValue = crypto.randomBytes(16).toString('hex');
  let seed = parseInt(seedValue.substring(0, 8), 16);
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  // Your exact color palettes
  const oliveColors = {
    greenOlives: ['#6B8E23', '#808000', '#9ACD32', '#7CFC00', '#ADFF2F'],
    blackOlives: ['#2F2F2F', '#404040', '#1C1C1C', '#36454F', '#28282B'],
    brownOlives: ['#8B4513', '#A0522D', '#CD853F', '#D2691E', '#BC9A6A'],
    purpleOlives: ['#663399', '#4B0082', '#800080', '#9932CC', '#8B008B'],
    ripeMixed: ['#6B8E23', '#2F2F2F', '#663399', '#8B4513']
  };

  const branchColors = {
    youngBranch: ['#8FBC8F', '#90EE90', '#98FB98', '#7CFC00'],
    matureBranch: ['#556B2F', '#6B8E23', '#808000', '#9ACD32'],
    brownBranch: ['#8B7355', '#A0522D', '#CD853F', '#DEB887'],
    silverBranch: ['#C0C0C0', '#D3D3D3', '#DCDCDC', '#F5F5F5']
  };

  const leafColors = {
    freshLeaves: ['#228B22', '#32CD32', '#00FF00', '#7CFC00'],
    matureLeaves: ['#006400', '#228B22', '#2E8B57', '#3CB371'],
    silverLeaves: ['#9ACD32', '#C0C0C0', '#D3D3D3', '#E6E6FA'],
    dryLeaves: ['#6B8E23', '#808000', '#BDB76B', '#F0E68C']
  };

  // Weighted random selection (your exact algorithm)
  const weightedSelection = (items) => {
    const totalWeight = Object.values(items).reduce((sum, item) => sum + item.weight, 0);
    let randomValue = random() * totalWeight;
    for (const [key, item] of Object.entries(items)) {
      randomValue -= item.weight;
      if (randomValue <= 0) return key;
    }
    return Object.keys(items)[0];
  };

  // Your exact rarity weights
  const oliveCountWeights = {
    1: { weight: 0.33 },
    2: { weight: 0.28 },
    3: { weight: 0.19 },
    4: { weight: 0.12 },
    5: { weight: 0.08 }
  };

  const oliveTypeWeights = {
    greenOlives: { weight: 0.30, displayName: 'Green Olives' },
    blackOlives: { weight: 0.25, displayName: 'Black Olives' },
    brownOlives: { weight: 0.20, displayName: 'Brown Olives' },
    purpleOlives: { weight: 0.15, displayName: 'Purple Olives' },
    ripeMixed: { weight: 0.10, displayName: 'Mixed Ripe Olives' }
  };

  // Generate using your weighted system
  const oliveCountKey = weightedSelection(oliveCountWeights);
  const oliveCount = parseInt(oliveCountKey);
  const oliveTypeKey = weightedSelection(oliveTypeWeights);
  const oliveType = oliveTypeWeights[oliveTypeKey].displayName;

  // Random color selection
  const getRandomColor = (colorArray) => {
    return colorArray[Math.floor(random() * colorArray.length)];
  };

  const oliveColorPalette = oliveColors[oliveTypeKey];
  const oliveColor = getRandomColor(oliveColorPalette);

  const branchPalettes = Object.values(branchColors);
  const randomBranchPalette = branchPalettes[Math.floor(random() * branchPalettes.length)];
  const branchColor = getRandomColor(randomBranchPalette);

  const leafPalettes = Object.values(leafColors);
  const randomLeafPalette = leafPalettes[Math.floor(random() * leafPalettes.length)];
  const leafColor = getRandomColor(randomLeafPalette);

  // Calculate rarity
  const rarity = calculateRarity(oliveCount, oliveTypeKey);

  return {
    seedValue,
    oliveCount,
    oliveType,
    oliveColor,
    branchColor,
    leafColor,
    ...rarity,
    oliveTypeKey // Store for further processing if needed
  };
};

// POST /api/olive-branches/generate - Generate new olive branch
router.post('/generate', requireAuth, async (req, res, next) => {
  try {
    // Check if user has seeds to plant
    const userSeeds = await prisma.inventoryItem.findFirst({
      where: {
        userId: req.user.id,
        itemType: 'seed',
        quantity: { gt: 0 }
      }
    });

    if (!userSeeds) {
      throw new ForbiddenError('You need at least one seed to generate an olive branch');
    }

    // Generate olive branch data
    const branchData = generateOliveBranchData();
    const botanicalId = await generateBotanicalId();

    // Generate SVG
    const svgContent = generateOliveBranchSVG(branchData);

    // Create olive branch in database with transaction
    const oliveBranch = await prisma.$transaction(async (tx) => {
      // Create the olive branch
      const branch = await tx.oliveBranch.create({
        data: {
          userId: req.user.id,
          seedValue: branchData.seedValue,
          oliveCount: branchData.oliveCount,
          oliveType: branchData.oliveType,
          oliveColor: branchData.oliveColor,
          branchColor: branchData.branchColor,
          leafColor: branchData.leafColor,
          countRarity: branchData.countRarity,
          typeRarity: branchData.typeRarity,
          countRarityPercentage: branchData.countRarityPercentage,
          typeRarityPercentage: branchData.typeRarityPercentage,
          botanicalId,
          svgCache: svgContent,
          isActive: true
        }
      });

      // Get the next available grid position for this user
      const maxPosition = await tx.inventoryItem.findFirst({
        where: { userId: req.user.id },
        orderBy: { gridPosition: 'desc' },
        select: { gridPosition: true }
      });

      const nextPosition = maxPosition?.gridPosition !== null && maxPosition?.gridPosition !== undefined
        ? maxPosition.gridPosition + 1
        : 0;

      // Add to user's inventory
      await tx.inventoryItem.create({
        data: {
          userId: req.user.id,
          itemType: 'branch',
          itemId: branch.id,
          quantity: 1,
          sourceType: 'generated',
          sourceReference: `gen-${Date.now()}`,
          gridPosition: nextPosition
        }
      });

      // Consume one seed
      if (userSeeds.quantity === 1) {
        await tx.inventoryItem.delete({
          where: { id: userSeeds.id }
        });
      } else {
        await tx.inventoryItem.update({
          where: { id: userSeeds.id },
          data: { quantity: { decrement: 1 } }
        });
      }

      return branch;
    });

    console.log('🌿 New olive branch generated:', oliveBranch.id, 'for user:', req.user.id);

    // Calculate trading value for response
    const tradingValue = calculateTradingValue(oliveBranch);

    res.status(201).json({
      message: 'Olive branch generated successfully!',
      oliveBranch: {
        id: oliveBranch.id,
        botanicalId: oliveBranch.botanicalId,
        oliveCount: oliveBranch.oliveCount,
        oliveType: oliveBranch.oliveType,
        countRarity: oliveBranch.countRarity,
        typeRarity: oliveBranch.typeRarity,
        createdAt: oliveBranch.createdAt,
        tradingValue
      },
      viewUrl: `/api/olive-branches/${oliveBranch.id}/svg`,
      rarityInfo: {
        countRarity: `${oliveBranch.countRarity} (${oliveBranch.countRarityPercentage}%)`,
        typeRarity: `${oliveBranch.typeRarity} (${oliveBranch.typeRarityPercentage}%)`
      },
      seedsRemaining: userSeeds.quantity - 1
    });

  } catch (error) {
    console.error('🔴 Error generating olive branch:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

// GET /api/olive-branches/:id/svg - Serve SVG content with enhanced caching
router.get('/:id/svg', async (req, res, next) => {
  try {
    const branchId = parseInt(req.params.id);
    
    if (isNaN(branchId)) {
      return res.status(400).json({ 
        error: 'Invalid branch ID',
        code: 'INVALID_BRANCH_ID' 
      });
    }

    const oliveBranch = await prisma.oliveBranch.findUnique({
      where: { id: branchId },
      select: {
        id: true,
        seedValue: true,
        oliveCount: true,
        oliveType: true,
        oliveColor: true,
        branchColor: true,
        leafColor: true,
        svgCache: true,
        botanicalId: true,
        user: {
          select: {
            username: true
          }
        }
      }
    });

    if (!oliveBranch) {
      throw new NotFoundError('Olive branch not found');
    }

    // If no cached SVG, regenerate it
    let svgContent = oliveBranch.svgCache;
    if (!svgContent) {
      const branchData = {
        seedValue: oliveBranch.seedValue,
        oliveCount: oliveBranch.oliveCount,
        oliveType: oliveBranch.oliveType,
        oliveColor: oliveBranch.oliveColor,
        branchColor: oliveBranch.branchColor,
        leafColor: oliveBranch.leafColor,
      };
      svgContent = generateOliveBranchSVG(branchData);
      
      // Cache the regenerated SVG
      await prisma.oliveBranch.update({
        where: { id: branchId },
        data: { svgCache: svgContent }
      });
    }

    // Enhanced headers for better caching and metadata
    res.set({
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
      'ETag': `"${oliveBranch.id}-${oliveBranch.botanicalId}"`,
      'X-Branch-Owner': oliveBranch.user.username,
      'X-Botanical-ID': oliveBranch.botanicalId
    });

    res.send(svgContent);

  } catch (error) {
    console.error('🔴 Error serving SVG:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

// GET /api/olive-branches/:id - Get detailed branch information
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const branchId = parseInt(req.params.id);
    
    if (isNaN(branchId)) {
      return res.status(400).json({ 
        error: 'Invalid branch ID',
        code: 'INVALID_BRANCH_ID' 
      });
    }

    const oliveBranch = await prisma.oliveBranch.findUnique({
      where: { id: branchId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            role: true
          }
        },
        inventoryItems: {
          select: {
            id: true,
            gridPosition: true,
            sourceType: true,
            sourceReference: true,
            createdAt: true
          }
        }
      }
    });

    if (!oliveBranch) {
      throw new NotFoundError('Olive branch not found');
    }

    // Check permissions
    const isOwner = oliveBranch.userId === req.user.id;
    const canView = isOwner || req.user.role === 'admin' || req.user.role === 'moderator';

    if (!canView) {
      throw new ForbiddenError('Access forbidden - not your branch');
    }

    // Calculate additional stats
    const tradingValue = calculateTradingValue(oliveBranch);
    const isActiveForUser = req.user.activeOliveBranchId === oliveBranch.id;
    
    // Check if this branch is currently being traded
    const activeTrade = await prisma.trade.findFirst({
      where: {
        inventoryItem: {
          itemId: oliveBranch.id,
          itemType: 'branch'
        },
        status: {
          in: ['pending', 'confirmed', 'shipping']
        }
      },
      select: {
        id: true,
        status: true,
        priceCents: true,
        currency: true,
        seller: {
          select: { username: true }
        },
        buyer: {
          select: { username: true }
        }
      }
    });

    res.json({
      oliveBranch: {
        id: oliveBranch.id,
        botanicalId: oliveBranch.botanicalId,
        seedValue: oliveBranch.seedValue,
        oliveCount: oliveBranch.oliveCount,
        oliveType: oliveBranch.oliveType,
        oliveColor: oliveBranch.oliveColor,
        branchColor: oliveBranch.branchColor,
        leafColor: oliveBranch.leafColor,
        countRarity: oliveBranch.countRarity,
        typeRarity: oliveBranch.typeRarity,
        countRarityPercentage: oliveBranch.countRarityPercentage,
        typeRarityPercentage: oliveBranch.typeRarityPercentage,
        isActive: oliveBranch.isActive,
        createdAt: oliveBranch.createdAt,
        owner: {
          id: oliveBranch.user.id,
          username: oliveBranch.user.username,
          role: oliveBranch.user.role
        }
      },
      stats: {
        tradingValue,
        isActiveForUser,
        isOwner,
        rarityScore: {
          count: { Common: 1, Uncommon: 2, Rare: 3, 'Very Rare': 4, Legendary: 5 }[oliveBranch.countRarity] || 1,
          type: { Common: 1, Uncommon: 2, Rare: 3, 'Very Rare': 4, Legendary: 5 }[oliveBranch.typeRarity] || 1
        },
        rarityInfo: {
          countRarity: `${oliveBranch.countRarity} (${oliveBranch.countRarityPercentage}%)`,
          typeRarity: `${oliveBranch.typeRarity} (${oliveBranch.typeRarityPercentage}%)`
        }
      },
      inventory: oliveBranch.inventoryItems.length > 0 ? oliveBranch.inventoryItems[0] : null,
      activeTrade: activeTrade,
      permissions: {
        canSetActive: isOwner && !isActiveForUser,
        canTrade: isOwner && !activeTrade,
        canView: canView,
        canEdit: isOwner || req.user.role === 'admin'
      },
      svgUrl: `/api/olive-branches/${oliveBranch.id}/svg`
    });

  } catch (error) {
    console.error('🔴 Error fetching branch details:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

// GET /api/olive-branches - Enhanced list with filtering and sorting
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      rarity,
      oliveType,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      active
    } = req.query;

    // Validate pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit))); // Max 50 per page
    const offset = (pageNum - 1) * limitNum;

    // Build where clause
    const where = {
      userId,
      isActive: true,
      svgCache: { not: { contains: '<!-- REGISTRATION_PREVIEW -->' } }
    };

    // Apply filters
    if (rarity) {
      where.OR = [
        { countRarity: { contains: rarity, mode: 'insensitive' } },
        { typeRarity: { contains: rarity, mode: 'insensitive' } }
      ];
    }

    if (oliveType) {
      where.oliveType = { contains: oliveType, mode: 'insensitive' };
    }

    if (active !== undefined) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { activeOliveBranchId: true }
      });

      if (active === 'true') {
        where.id = user.activeOliveBranchId;
      } else if (active === 'false') {
        where.id = { not: user.activeOliveBranchId };
      }
    }

    // Validate sort options
    const validSortFields = ['createdAt', 'oliveCount', 'botanicalId', 'countRarity', 'typeRarity'];
    const validSortOrders = ['asc', 'desc'];
    
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const sortDirection = validSortOrders.includes(sortOrder) ? sortOrder : 'desc';

    // Get branches with count
    const [oliveBranches, total] = await Promise.all([
      prisma.oliveBranch.findMany({
        where,
        orderBy: { [sortField]: sortDirection },
        skip: offset,
        take: limitNum,
        select: {
          id: true,
          botanicalId: true,
          oliveCount: true,
          oliveType: true,
          oliveColor: true,
          branchColor: true,
          leafColor: true,
          countRarity: true,
          typeRarity: true,
          countRarityPercentage: true,
          typeRarityPercentage: true,
          createdAt: true,
          isActive: true
        }
      }),
      prisma.oliveBranch.count({ where })
    ]);

    // Add computed fields
    const branchesWithExtras = oliveBranches.map(branch => ({
      ...branch,
      svgUrl: `/api/olive-branches/${branch.id}/svg`,
      tradingValue: calculateTradingValue(branch),
      isActiveForUser: req.user.activeOliveBranchId === branch.id,
      rarityInfo: {
        countRarity: `${branch.countRarity} (${branch.countRarityPercentage}%)`,
        typeRarity: `${branch.typeRarity} (${branch.typeRarityPercentage}%)`
      }
    }));

    const totalPages = Math.ceil(total / limitNum);

    res.json({
      oliveBranches: branchesWithExtras,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      },
      filters: {
        rarity: rarity || null,
        oliveType: oliveType || null,
        active: active || null,
        sortBy: sortField,
        sortOrder: sortDirection
      },
      summary: {
        totalBranches: total,
        pageCount: branchesWithExtras.length
      }
    });

  } catch (error) {
    console.error('🔴 Error fetching olive branches:', error);
    next(error);
  }
});

// PUT /api/olive-branches/:id/set-active - Set as user's active branch
router.put('/:id/set-active', requireAuth, async (req, res, next) => {
  try {
    const branchId = parseInt(req.params.id);
    
    if (isNaN(branchId)) {
      return res.status(400).json({ 
        error: 'Invalid branch ID',
        code: 'INVALID_BRANCH_ID' 
      });
    }

    // Verify branch exists and belongs to user
    const branch = await prisma.oliveBranch.findFirst({
      where: {
        id: branchId,
        userId: req.user.id,
        isActive: true
      }
    });

    if (!branch) {
      throw new NotFoundError('Olive branch not found or not owned by you');
    }

    // Update user's active branch
    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: { activeOliveBranchId: branchId },
      select: {
        id: true,
        activeOliveBranchId: true,
        activeOliveBranch: {
          select: {
            id: true,
            botanicalId: true,
            oliveType: true
          }
        }
      }
    });

    res.json({
      message: 'Active olive branch updated successfully',
      activeBranch: {
        id: updatedUser.activeOliveBranch.id,
        botanicalId: updatedUser.activeOliveBranch.botanicalId,
        oliveType: updatedUser.activeOliveBranch.oliveType,
        svgUrl: `/api/olive-branches/${updatedUser.activeOliveBranch.id}/svg`
      }
    });

  } catch (error) {
    console.error('🔴 Error setting active branch:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

// GET /api/olive-branches/stats/summary - Get user's collection summary
router.get('/stats/summary', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get collection statistics
    const [
      totalBranches,
      rarityBreakdown,
      typeBreakdown,
      activeBranch,
      totalSeeds
    ] = await Promise.all([
      prisma.oliveBranch.count({
        where: {
          userId,
          isActive: true,
          svgCache: { not: { contains: '<!-- REGISTRATION_PREVIEW -->' } }
        }
      }),
      prisma.oliveBranch.groupBy({
        by: ['countRarity'],
        where: {
          userId,
          isActive: true,
          svgCache: { not: { contains: '<!-- REGISTRATION_PREVIEW -->' } }
        },
        _count: { countRarity: true }
      }),
      prisma.oliveBranch.groupBy({
        by: ['oliveType'],
        where: {
          userId,
          isActive: true,
          svgCache: { not: { contains: '<!-- REGISTRATION_PREVIEW -->' } }
        },
        _count: { oliveType: true }
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          activeOliveBranch: {
            select: {
              id: true,
              botanicalId: true,
              oliveType: true,
              countRarity: true,
              typeRarity: true
            }
          }
        }
      }),
      prisma.inventoryItem.aggregate({
        where: {
          userId,
          itemType: 'seed'
        },
        _sum: {
          quantity: true
        }
      })
    ]);

    // Get most valuable branch
    const mostValuableBranch = await prisma.oliveBranch.findFirst({
      where: {
        userId,
        isActive: true,
        svgCache: { not: { contains: '<!-- REGISTRATION_PREVIEW -->' } }
      },
      orderBy: [
        { countRarityPercentage: 'asc' },
        { typeRarityPercentage: 'asc' },
        { oliveCount: 'desc' }
      ],
      select: {
        id: true,
        botanicalId: true,
        oliveType: true,
        countRarity: true,
        typeRarity: true,
        oliveCount: true
      }
    });

    res.json({
      summary: {
        totalBranches,
        totalSeeds: totalSeeds._sum.quantity || 0,
        activeBranch: activeBranch?.activeOliveBranch || null,
        mostValuableBranch: mostValuableBranch ? {
          ...mostValuableBranch,
          tradingValue: calculateTradingValue(mostValuableBranch),
          svgUrl: `/api/olive-branches/${mostValuableBranch.id}/svg`
        } : null
      },
      breakdown: {
        byRarity: rarityBreakdown.map(item => ({
          rarity: item.countRarity,
          count: item._count.countRarity
        })),
        byType: typeBreakdown.map(item => ({
          type: item.oliveType,
          count: item._count.oliveType
        }))
      },
      collectionScore: {
        diversityBonus: typeBreakdown.length * 5,
        quantityScore: totalBranches * 2,
        rarityBonus: rarityBreakdown.reduce((acc, item) => {
          const bonus = { Common: 1, Uncommon: 3, Rare: 5, 'Very Rare': 8, Legendary: 12 }[item.countRarity] || 1;
          return acc + (bonus * item._count.countRarity);
        }, 0)
      },
      canGenerate: totalSeeds._sum.quantity > 0
    });

  } catch (error) {
    console.error('🔴 Error fetching collection summary:', error);
    next(error);
  }
});

module.exports = router;