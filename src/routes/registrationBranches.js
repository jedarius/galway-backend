// src/routes/registrationBranches.js
// Complete Registration-specific branch generation with personality tracking

const express = require('express');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { body, validationResult } = require('express-validator');

const { requireAuth } = require('../middleware/auth');
const { generateOliveBranchSVG } = require('../services/oliveBranchGenerator');

const router = express.Router();
const prisma = new PrismaClient();

console.log('🔵 Full registration routes loaded successfully!');

// Custom error classes
class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.statusCode = 400;
    this.code = 'VALIDATION_ERROR';
    this.details = details;
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

// Weighted random selection matching original system
const weightedSelection = (items, random) => {
  const totalWeight = Object.values(items).reduce((sum, item) => sum + item.weight, 0);
  let randomValue = random() * totalWeight;
  
  for (const [key, item] of Object.entries(items)) {
    randomValue -= item.weight;
    if (randomValue <= 0) return key;
  }
  
  return Object.keys(items)[0];
};

// Generate olive branch data with personality tracking
const generateRegistrationBranchData = () => {
  const seedValue = crypto.randomBytes(16).toString('hex');
  
  let seed = parseInt(seedValue.substring(0, 8), 16);
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  // Exact color palettes from original
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

  const oliveCountWeights = {
    1: { weight: 0.33 },
    2: { weight: 0.28 },
    3: { weight: 0.19 },
    4: { weight: 0.12 },
    5: { weight: 0.08 }
  };

  const oliveTypeWeights = {
    greenOlives: { weight: 0.30, displayName: 'Green Olives', rarity: 'Common', rarityScore: 1 },
    blackOlives: { weight: 0.25, displayName: 'Black Olives', rarity: 'Common', rarityScore: 2 },
    brownOlives: { weight: 0.20, displayName: 'Brown Olives', rarity: 'Uncommon', rarityScore: 3 },
    purpleOlives: { weight: 0.15, displayName: 'Purple Olives', rarity: 'Rare', rarityScore: 4 },
    ripeMixed: { weight: 0.10, displayName: 'Mixed Ripe Olives', rarity: 'Very Rare', rarityScore: 5 }
  };

  const countRarities = {
    1: { name: 'Common', percentage: 33, rarityScore: 1 },
    2: { name: 'Common', percentage: 28, rarityScore: 2 },
    3: { name: 'Uncommon', percentage: 19, rarityScore: 3 },
    4: { name: 'Rare', percentage: 12, rarityScore: 4 },
    5: { name: 'Very Rare', percentage: 8, rarityScore: 5 }
  };

  const getRandomColor = (colorArray) => {
    return colorArray[Math.floor(random() * colorArray.length)];
  };

  // Generate branch characteristics
  const oliveCountKey = weightedSelection(oliveCountWeights, random);
  const oliveCount = parseInt(oliveCountKey);
  
  const oliveTypeKey = weightedSelection(oliveTypeWeights, random);
  const oliveTypeData = oliveTypeWeights[oliveTypeKey];

  const oliveColorPalette = oliveColors[oliveTypeKey];
  const oliveColor = getRandomColor(oliveColorPalette);

  const branchPalettes = Object.values(branchColors);
  const randomBranchPalette = branchPalettes[Math.floor(random() * branchPalettes.length)];
  const branchColor = getRandomColor(randomBranchPalette);

  const leafPalettes = Object.values(leafColors);
  const randomLeafPalette = leafPalettes[Math.floor(random() * leafPalettes.length)];
  const leafColor = getRandomColor(randomLeafPalette);

  // Calculate rarity scores for personality analysis
  const countRarity = countRarities[oliveCount];
  const totalRarityScore = countRarity.rarityScore + oliveTypeData.rarityScore;

  // Calculate trading value (seeds)
  const baseTradingValue = Math.floor(totalRarityScore * 1.5) + Math.floor(oliveCount * 0.5);

  return {
    seedValue,
    oliveCount,
    oliveType: oliveTypeData.displayName,
    oliveColor,
    branchColor,
    leafColor,
    countRarity: countRarity.name,
    countRarityPercentage: countRarity.percentage,
    typeRarity: oliveTypeData.rarity,
    typeRarityPercentage: Math.round(oliveTypeData.weight * 100),
    totalRarityScore,
    tradingValue: baseTradingValue,
    oliveTypeKey // Store for personality analysis
  };
};

// Test endpoint
router.get('/test', (req, res) => {
  console.log('🟢 Registration test endpoint hit!');
  res.json({ 
    message: 'Registration routes are working!', 
    timestamp: new Date().toISOString() 
  });
});

// Test auth endpoint
router.get('/test-auth', requireAuth, (req, res) => {
  console.log('🟢 Auth test endpoint hit for user:', req.user.id);
  res.json({ 
    message: 'Auth is working', 
    user: req.user,
    timestamp: new Date() 
  });
});

// POST /api/registration/generate-starter-branch - Generate preview branch
router.post('/generate-starter-branch', requireAuth, async (req, res, next) => {
  console.log('🔍 Starting generate-starter-branch for user:', req.user.id);
  
  try {
    // Check if user has already completed registration (has non-preview branches)
    const completedBranches = await prisma.oliveBranch.count({
      where: {
        userId: req.user.id,
        svgCache: { not: { contains: '<!-- REGISTRATION_PREVIEW -->' } }
      }
    });

    if (completedBranches > 0) {
      throw new ForbiddenError('Registration already completed. Use normal branch generation.');
    }

    // Check how many starter branches already generated (burn-as-you-go model allows only 1)
    const existingStarters = await prisma.oliveBranch.count({
      where: {
        userId: req.user.id,
        svgCache: { contains: '<!-- REGISTRATION_PREVIEW -->' }
      }
    });

    if (existingStarters >= 1) {
      throw new ForbiddenError('You can only generate one starter branch. Please confirm or regenerate.');
    }

    // Generate branch data
    console.log('🔍 Generating branch data...');
    const branchData = generateRegistrationBranchData();
    const botanicalId = await generateBotanicalId();

    // Generate SVG with registration preview marker
    let svgContent = generateOliveBranchSVG(branchData);
    svgContent = svgContent.replace('</svg>', '<!-- REGISTRATION_PREVIEW --></svg>');

    console.log('🔍 Creating olive branch in database...');
    
    // Create temporary registration branch
    const oliveBranch = await prisma.oliveBranch.create({
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
        isActive: false // Not active until confirmed
      }
    });

    console.log('🟢 Starter branch generated successfully:', oliveBranch.id);

    res.status(201).json({
      message: 'Starter branch generated successfully!',
      oliveBranch: {
        id: oliveBranch.id,
        botanicalId: oliveBranch.botanicalId,
        oliveCount: oliveBranch.oliveCount,
        oliveType: oliveBranch.oliveType,
        countRarity: oliveBranch.countRarity,
        typeRarity: oliveBranch.typeRarity,
        createdAt: oliveBranch.createdAt,
        tradingValue: branchData.tradingValue,
        totalRarityScore: branchData.totalRarityScore
      },
      viewUrl: `/api/olive-branches/${oliveBranch.id}/svg`,
      rarityInfo: {
        countRarity: `${oliveBranch.countRarity} (${oliveBranch.countRarityPercentage}%)`,
        typeRarity: `${oliveBranch.typeRarity} (${oliveBranch.typeRarityPercentage}%)`,
        totalRarityScore: branchData.totalRarityScore,
        tradingValue: `~${branchData.tradingValue} seeds`
      },
      psychologicalTriggers: {
        uniqueness: "This exact olive combination will never exist again",
        burnAsYouGo: "Generate another branch and this one will be lost forever",
        canConfirm: true
      }
    });

  } catch (error) {
    console.error('🔴 Error in confirm-starter-branch:', error);
    console.error('🔴 Error code:', error.code);
    console.error('🔴 Error stack:', error.stack);
    
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
      });
    }
    next(error);
  }
});

// POST /api/registration/confirm-starter-branch - Final selection (BURN AS YOU GO MODEL)
router.post('/confirm-starter-branch', requireAuth, async (req, res, next) => {
    console.log('🔍 Starting confirmation for user:', req.user.id);
    try {
        // Get current starter branch (only one exists in burn-as-you-go model)
        const starterBranch = await prisma.oliveBranch.findFirst({
            where: {
                userId: req.user.id,
                svgCache: { contains: '<!-- REGISTRATION_PREVIEW -->' }
            }
        });

        if (!starterBranch) {
            throw new ForbiddenError('No starter branch found. Generate a branch first.');
        }

        console.log('🔍 Found starter branch:', starterBranch.id);

        // Determine personality based on branch characteristics
        let personalityType = 'balanced';
        let badges = [];
        const rarity = starterBranch.countRarity;
        const typeRarity = starterBranch.typeRarity;

        if ((rarity === 'Very Rare' || typeRarity === 'Very Rare') && starterBranch.oliveCount >= 4) {
            personalityType = 'rarity_seeker';
            badges.push('Collector');
        } else if (rarity === 'Common' && typeRarity === 'Common') {
            personalityType = 'minimalist';
            badges.push('Minimalist');
        } else {
            personalityType = 'aesthetic_focused';
            badges.push('Visionary');
        }

        console.log('🔍 Personality analysis:', personalityType, badges);

        // Transaction: Confirm chosen branch, update user profile
        const result = await prisma.$transaction(async (tx) => {
            // Remove registration preview marker from chosen branch
            const cleanSvg = starterBranch.svgCache.replace('<!-- REGISTRATION_PREVIEW -->', '');
            
            // Update chosen branch to be permanent and active
            const finalBranch = await tx.oliveBranch.update({
                where: { id: starterBranch.id },
                data: {
                    svgCache: cleanSvg,
                    isActive: true
                }
            });

            console.log('🔍 Updated branch to be permanent:', finalBranch.id);

            // Get the next available grid position for this user
            const maxPosition = await tx.inventoryItem.findFirst({
                where: { userId: req.user.id },
                orderBy: { gridPosition: 'desc' },
                select: { gridPosition: true }
            });
            
            const nextPosition = maxPosition?.gridPosition !== null && maxPosition?.gridPosition !== undefined 
                ? maxPosition.gridPosition + 1 
                : 0;

            console.log('🔍 Next grid position:', nextPosition);

            // Add chosen branch to inventory with proper position
            // Add chosen branch to inventory with proper position
              const inventoryItem = await tx.inventoryItem.create({
              data: {
                userId: req.user.id,
                itemType: 'branch',
                itemId: finalBranch.id,
                quantity: 1,
                sourceType: 'registration', // Shortened to fit 20 char limit
                sourceReference: `reg-${finalBranch.id}`, // Short reference
                gridPosition: nextPosition
                }
                });

            console.log('🔍 Created inventory item:', inventoryItem.id);

            // Update user with personality profile and set active branch
            const updatedUser = await tx.user.update({
                where: { id: req.user.id },
                data: {
                    activeOliveBranchId: finalBranch.id,
                    bio: `${badges.join(', ')} • Registration choice: ${personalityType}`
                }
            });

            console.log('🔍 Updated user profile for:', updatedUser.id);

            return { finalBranch, inventoryItem, updatedUser };
        });

        console.log('🟢 Registration completed successfully for user:', req.user.id);

        res.json({
            message: 'Registration completed successfully!',
            chosenBranch: {
                id: result.finalBranch.id,
                botanicalId: result.finalBranch.botanicalId,
                oliveCount: result.finalBranch.oliveCount,
                oliveType: result.finalBranch.oliveType,
                countRarity: result.finalBranch.countRarity,
                typeRarity: result.finalBranch.typeRarity,
                isActive: result.finalBranch.isActive
            },
            inventoryItem: {
                id: result.inventoryItem.id,
                gridPosition: result.inventoryItem.gridPosition,
                sourceType: result.inventoryItem.sourceType
            },
            personalityProfile: {
                type: personalityType,
                badges: badges,
                gamblingStyle: 'burn_as_you_go_model'
            },
            registrationComplete: true,
            nextSteps: {
                exploreMarketplace: true,
                earnMoreSeeds: true,
                viewAchievements: true
            }
        });

    } catch (error) {
        console.error('🔴 Error in confirm-starter-branch:', error);
        console.error('🔴 Error code:', error.code);
        console.error('🔴 Error stack:', error.stack);
        
        if (error.statusCode) {
            return res.status(error.statusCode).json({
                error: error.message,
                code: error.code,
            });
        }
        next(error);
    }
});


// GET /api/registration/starter-branches - View generated starter branches
router.get('/starter-branches', requireAuth, async (req, res, next) => {
  try {
    const starterBranches = await prisma.oliveBranch.findMany({
      where: {
        userId: req.user.id,
        svgCache: { contains: '<!-- REGISTRATION_PREVIEW -->' }
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        botanicalId: true,
        oliveCount: true,
        oliveType: true,
        countRarity: true,
        typeRarity: true,
        countRarityPercentage: true,
        typeRarityPercentage: true,
        createdAt: true,
        oliveColor: true,
        branchColor: true,
        leafColor: true
      }
    });

    res.json({
      branches: starterBranches.map(branch => ({
        ...branch,
        svgUrl: `/api/olive-branches/${branch.id}/svg`
      })),
      canGenerate: starterBranches.length === 0, // Burn-as-you-go: only allow 1
      mustChoose: starterBranches.length > 0
    });

  } catch (error) {
    next(error);
  }
});

// DELETE /api/registration/reset-starter-branches - Reset registration (for testing)
router.delete('/reset-starter-branches', requireAuth, async (req, res, next) => {
  try {
    console.log('🔍 Resetting starter branches for user:', req.user.id);
    
    // Delete all preview branches for this user
    const deleted = await prisma.oliveBranch.deleteMany({
      where: {
        userId: req.user.id,
        svgCache: { contains: '<!-- REGISTRATION_PREVIEW -->' }
      }
    });

    res.json({
      message: 'Starter branches reset successfully',
      deletedCount: deleted.count,
      canGenerateNew: true
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router;