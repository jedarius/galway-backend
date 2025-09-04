// src/services/oliveBranchGenerator.js
// Enhanced Olive Branch Generator with boost support
const crypto = require('crypto');

// Background color constant
const OLIVE_BRANCH_BG_COLOR = '#F5F5DC'; // Beige background

// Enhanced color palettes with boost variations
const COLOR_PALETTES = {
  // Standard palettes
  oliveColors: {
    greenOlives: ['#6B8E23', '#808000', '#9ACD32', '#7CFC00', '#ADFF2F'],
    blackOlives: ['#2F2F2F', '#404040', '#1C1C1C', '#36454F', '#28282B'],
    brownOlives: ['#8B4513', '#A0522D', '#CD853F', '#D2691E', '#BC9A6A'],
    purpleOlives: ['#663399', '#4B0082', '#800080', '#9932CC', '#8B008B'],
    ripeMixed: ['#6B8E23', '#2F2F2F', '#663399', '#8B4513']
  },
  
  branchColors: {
    youngBranch: ['#8FBC8F', '#90EE90', '#98FB98', '#7CFC00'],
    matureBranch: ['#556B2F', '#6B8E23', '#808000', '#9ACD32'],
    brownBranch: ['#8B7355', '#A0522D', '#CD853F', '#DEB887'],
    silverBranch: ['#C0C0C0', '#D3D3D3', '#DCDCDC', '#F5F5F5']
  },
  
  leafColors: {
    freshLeaves: ['#228B22', '#32CD32', '#00FF00', '#7CFC00'],
    matureLeaves: ['#006400', '#228B22', '#2E8B57', '#3CB371'],
    silverLeaves: ['#9ACD32', '#C0C0C0', '#D3D3D3', '#E6E6FA'],
    dryLeaves: ['#6B8E23', '#808000', '#BDB76B', '#F0E68C']
  },

  // Seasonal/Boost palettes
  seasonalColors: {
    winterFrost: {
      olives: ['#B0E0E6', '#87CEEB', '#4682B4', '#5F9EA0'],
      branches: ['#708090', '#778899', '#2F4F4F', '#696969'],
      leaves: ['#F0F8FF', '#E6E6FA', '#D3D3D3', '#C0C0C0']
    },
    autumnGold: {
      olives: ['#DAA520', '#B8860B', '#CD853F', '#D2691E'],
      branches: ['#8B4513', '#A0522D', '#CD853F', '#DEB887'],
      leaves: ['#FF8C00', '#FFA500', '#FFD700', '#F0E68C']
    },
    springBloom: {
      olives: ['#98FB98', '#90EE90', '#7CFC00', '#ADFF2F'],
      branches: ['#8FBC8F', '#9ACD32', '#6B8E23', '#556B2F'],
      leaves: ['#00FF7F', '#00FA9A', '#32CD32', '#228B22']
    },
    mysticPurple: {
      olives: ['#9370DB', '#8A2BE2', '#9932CC', '#BA55D3'],
      branches: ['#4B0082', '#483D8B', '#6A5ACD', '#7B68EE'],
      leaves: ['#DDA0DD', '#DA70D6', '#EE82EE', '#FF69B4']
    }
  }
};

// Rarity configurations
const RARITY_CONFIG = {
  countRarities: {
    1: { name: 'Common', percentage: 33, weight: 0.33, score: 1 },
    2: { name: 'Common', percentage: 28, weight: 0.28, score: 2 },
    3: { name: 'Uncommon', percentage: 19, weight: 0.19, score: 3 },
    4: { name: 'Rare', percentage: 12, weight: 0.12, score: 4 },
    5: { name: 'Very Rare', percentage: 8, weight: 0.08, score: 5 }
  },
  
  typeRarities: {
    greenOlives: { name: 'Common', percentage: 30, weight: 0.30, score: 1 },
    blackOlives: { name: 'Common', percentage: 25, weight: 0.25, score: 2 },
    brownOlives: { name: 'Uncommon', percentage: 20, weight: 0.20, score: 3 },
    purpleOlives: { name: 'Rare', percentage: 15, weight: 0.15, score: 4 },
    ripeMixed: { name: 'Very Rare', percentage: 10, weight: 0.10, score: 5 }
  }
};

// Generation boost effects
const applyGenerationBoost = (baseWeights, boostConfig) => {
  if (!boostConfig || !boostConfig.isActive) {
    return baseWeights;
  }

  const boostedWeights = { ...baseWeights };
  
  // Apply rarity boost
  if (boostConfig.type === 'rarity_increase') {
    // Increase weights for rare items
    Object.keys(boostedWeights).forEach(key => {
      const rarity = RARITY_CONFIG.typeRarities[key] || RARITY_CONFIG.countRarities[key];
      if (rarity && rarity.score >= 4) { // Boost rare and very rare
        boostedWeights[key].weight *= (boostConfig.multiplier || 1.5);
      }
    });
  }
  
  // Normalize weights
  const totalWeight = Object.values(boostedWeights).reduce((sum, item) => sum + item.weight, 0);
  Object.keys(boostedWeights).forEach(key => {
    boostedWeights[key].weight = boostedWeights[key].weight / totalWeight;
  });

  return boostedWeights;
};

// Weighted random selection
const weightedSelection = (items, random) => {
  const totalWeight = Object.values(items).reduce((sum, item) => sum + (item.weight || 0), 0);
  let randomValue = random() * totalWeight;
  
  for (const [key, item] of Object.entries(items)) {
    randomValue -= (item.weight || 0);
    if (randomValue <= 0) return key;
  }
  
  return Object.keys(items)[0];
};

// Enhanced random color selection with seasonal support
const getRandomColor = (colorArray, random, seasonalPalette = null) => {
  if (seasonalPalette && Array.isArray(seasonalPalette)) {
    // Use seasonal colors if available
    return seasonalPalette[Math.floor(random() * seasonalPalette.length)];
  }
  return colorArray[Math.floor(random() * colorArray.length)];
};

// Main generation function with boost support
const generateOliveBranchData = (boostConfig = null, seedCategory = 'basic') => {
  const seedValue = crypto.randomBytes(16).toString('hex');
  let seed = parseInt(seedValue.substring(0, 8), 16);
  
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  // Apply generation boosts to weights
  let oliveCountWeights = { ...RARITY_CONFIG.countRarities };
  let oliveTypeWeights = { ...RARITY_CONFIG.typeRarities };

  if (boostConfig) {
    oliveCountWeights = applyGenerationBoost(oliveCountWeights, boostConfig);
    oliveTypeWeights = applyGenerationBoost(oliveTypeWeights, boostConfig);
  }

  // Premium seeds get inherent rarity boost
  if (seedCategory === 'premium') {
    Object.keys(oliveCountWeights).forEach(key => {
      const rarity = oliveCountWeights[key];
      if (rarity.score >= 3) { // Boost uncommon and above
        oliveCountWeights[key].weight *= 1.3;
      }
    });
    
    Object.keys(oliveTypeWeights).forEach(key => {
      const rarity = oliveTypeWeights[key];
      if (rarity.score >= 3) {
        oliveTypeWeights[key].weight *= 1.3;
      }
    });
  }

  // Generate branch characteristics
  const oliveCountKey = weightedSelection(oliveCountWeights, random);
  const oliveCount = parseInt(oliveCountKey);
  const oliveTypeKey = weightedSelection(oliveTypeWeights, random);

  // Get type info
  const typeInfo = RARITY_CONFIG.typeRarities[oliveTypeKey];
  const countInfo = RARITY_CONFIG.countRarities[oliveCount];

  // Determine color palette (seasonal vs standard)
  let activePalette = COLOR_PALETTES;
  let seasonalEffect = null;

  if (boostConfig && boostConfig.seasonalColors) {
    const seasonKeys = Object.keys(COLOR_PALETTES.seasonalColors);
    const randomSeason = seasonKeys[Math.floor(random() * seasonKeys.length)];
    seasonalEffect = COLOR_PALETTES.seasonalColors[randomSeason];
  }

  // Special handling for seasonal seeds
  if (seedCategory === 'seasonal' && !seasonalEffect) {
    const seasonKeys = Object.keys(COLOR_PALETTES.seasonalColors);
    const randomSeason = seasonKeys[Math.floor(random() * seasonKeys.length)];
    seasonalEffect = COLOR_PALETTES.seasonalColors[randomSeason];
  }

  // Generate colors
  let oliveColor, branchColor, leafColor;

  if (seasonalEffect) {
    oliveColor = getRandomColor(null, random, seasonalEffect.olives);
    branchColor = getRandomColor(null, random, seasonalEffect.branches);
    leafColor = getRandomColor(null, random, seasonalEffect.leaves);
  } else {
    // Standard color generation
    const oliveColorPalette = activePalette.oliveColors[oliveTypeKey];
    oliveColor = getRandomColor(oliveColorPalette, random);

    const branchPalettes = Object.values(activePalette.branchColors);
    const randomBranchPalette = branchPalettes[Math.floor(random() * branchPalettes.length)];
    branchColor = getRandomColor(randomBranchPalette, random);

    const leafPalettes = Object.values(activePalette.leafColors);
    const randomLeafPalette = leafPalettes[Math.floor(random() * leafPalettes.length)];
    leafColor = getRandomColor(randomLeafPalette, random);
  }

  // Calculate final rarity score
  const totalRarityScore = countInfo.score + typeInfo.score;
  const tradingValue = Math.floor(totalRarityScore * 1.5) + Math.floor(oliveCount * 0.5);

  return {
    seedValue,
    oliveCount,
    oliveType: typeInfo.displayName || 'Unknown Type',
    oliveTypeKey,
    oliveColor,
    branchColor,
    leafColor,
    countRarity: countInfo.name,
    typeRarity: typeInfo.name,
    countRarityPercentage: countInfo.percentage,
    typeRarityPercentage: typeInfo.percentage,
    totalRarityScore,
    tradingValue,
    seasonalEffect: seasonalEffect ? true : false,
    boostApplied: boostConfig ? true : false,
    seedCategory
  };
};

// Enhanced SVG generation with improved visuals
const generateOliveBranchSVG = (branchData) => {
  const { oliveCount, oliveColor, branchColor, leafColor, seedValue } = branchData;
  
  // Use seed for consistent positioning
  let seed = parseInt(seedValue.substring(0, 8), 16);
  const seededRandom = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  // Enhanced SVG with better styling
  let svg = `<svg width="100%" height="100%" viewBox="0 0 70 70" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="1" dy="1" stdDeviation="0.5" flood-color="rgba(0,0,0,0.1)"/>
      </filter>
      <linearGradient id="branchGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${branchColor};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${adjustBrightness(branchColor, -20)};stop-opacity:1" />
      </linearGradient>
      <radialGradient id="oliveGradient" cx="30%" cy="30%" r="70%">
        <stop offset="0%" style="stop-color:${adjustBrightness(oliveColor, 20)};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${oliveColor};stop-opacity:1" />
      </radialGradient>
    </defs>
    
    <!-- Background -->
    <rect width="70" height="70" fill="${OLIVE_BRANCH_BG_COLOR}"/>
    
    <!-- Main stem with gradient -->
    <rect x="33" y="20" width="4" height="30" fill="url(#branchGradient)" filter="url(#softShadow)" rx="1"/>`;

  // Generate branches and elements based on olive count
  const positions = [];
  
  // Create natural branch distribution
  for (let i = 0; i < Math.min(oliveCount, 5); i++) {
    const progress = i / Math.max(oliveCount - 1, 1);
    const baseY = 25 + (progress * 20);
    const side = i % 2 === 0 ? -1 : 1;
    const branchLength = 8 + seededRandom() * 6;
    
    positions.push({
      branchX: 35 + (side * 2),
      branchY: baseY,
      branchEndX: 35 + (side * branchLength),
      branchEndY: baseY + (seededRandom() - 0.5) * 4,
      oliveX: 35 + (side * (branchLength - 2)),
      oliveY: baseY - 1,
      leafX: 35 + (side * (branchLength + 2)),
      leafY: baseY - 2,
      side
    });
  }

  // Draw branches
  positions.forEach(pos => {
    svg += `<line x1="${pos.branchX}" y1="${pos.branchY}" x2="${pos.branchEndX}" y2="${pos.branchEndY}" 
            stroke="url(#branchGradient)" stroke-width="2" stroke-linecap="round" filter="url(#softShadow)"/>`;
  });

  // Draw leaves
  positions.forEach(pos => {
    const leafWidth = 4 + seededRandom() * 2;
    const leafHeight = 6 + seededRandom() * 2;
    svg += `<ellipse cx="${pos.leafX}" cy="${pos.leafY}" rx="${leafWidth/2}" ry="${leafHeight/2}" 
            fill="${leafColor}" opacity="0.9" filter="url(#softShadow)"/>`;
  });

  // Draw olives with enhanced styling
  positions.slice(0, oliveCount).forEach(pos => {
    const oliveSize = 3 + seededRandom() * 1.5;
    svg += `<ellipse cx="${pos.oliveX}" cy="${pos.oliveY}" rx="${oliveSize/2}" ry="${oliveSize}" 
            fill="url(#oliveGradient)" filter="url(#softShadow)"/>`;
    
    // Add highlight
    svg += `<ellipse cx="${pos.oliveX - 0.5}" cy="${pos.oliveY - 0.5}" rx="${oliveSize/4}" ry="${oliveSize/2}" 
            fill="rgba(255,255,255,0.3)"/>`;
  });

  svg += `</svg>`;
  return svg;
};

// Helper function to adjust color brightness
const adjustBrightness = (hex, percent) => {
  const num = parseInt(hex.replace("#", ""), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
    (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
    (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
};

// Function to get active generation boosts
const getActiveBoosts = async (prisma) => {
  const now = new Date();
  return await prisma.generationBoost.findMany({
    where: {
      isActive: true,
      startTime: { lte: now },
      endTime: { gte: now }
    }
  });
};

// Function to check if user has boost available
const getUserBoost = async (prisma, userId, boostId) => {
  return await prisma.userGenerationBoost.findFirst({
    where: {
      userId,
      boostId,
      usesRemaining: { gt: 0 },
      expiresAt: { gt: new Date() }
    }
  });
};

// Enhanced generation with boost integration
const generateWithBoosts = async (prisma, userId, seedCategory = 'basic') => {
  // Get active boosts
  const activeBoosts = await getActiveBoosts(prisma);
  
  let bestBoost = null;
  let userBoost = null;

  // Check if user has any personal boosts
  for (const boost of activeBoosts) {
    const userBoostData = await getUserBoost(prisma, userId, boost.id);
    if (userBoostData) {
      bestBoost = {
        isActive: true,
        type: boost.boostType,
        multiplier: boost.rarityMultiplier,
        seasonalColors: boost.colorPalettes,
        boostId: boost.id
      };
      userBoost = userBoostData;
      break; // Use first available boost
    }
  }

  // If no personal boost, check for global boosts
  if (!bestBoost && activeBoosts.length > 0) {
    const globalBoost = activeBoosts[0]; // Use first active global boost
    bestBoost = {
      isActive: true,
      type: globalBoost.boostType,
      multiplier: globalBoost.rarityMultiplier,
      seasonalColors: globalBoost.colorPalettes
    };
  }

  // Generate branch with boost
  const branchData = generateOliveBranchData(bestBoost, seedCategory);

  // If user had a personal boost, consume one use
  if (userBoost) {
    await prisma.userGenerationBoost.update({
      where: { id: userBoost.id },
      data: { usesRemaining: { decrement: 1 } }
    });
  }

  return branchData;
};

// Function to create preview branch (for registration)
const generatePreviewBranch = () => {
  return generateOliveBranchData(null, 'basic');
};

// Function to generate themed branches for special events
const generateThemedBranch = (theme, seedCategory = 'seasonal') => {
  const themeBoost = {
    isActive: true,
    type: 'seasonal_colors',
    multiplier: 1.2,
    seasonalColors: theme
  };
  
  return generateOliveBranchData(themeBoost, seedCategory);
};

// Rarity calculation helper
const calculateRarityScore = (branchData) => {
  const countScore = RARITY_CONFIG.countRarities[branchData.oliveCount]?.score || 1;
  const typeScore = RARITY_CONFIG.typeRarities[branchData.oliveTypeKey]?.score || 1;
  return countScore + typeScore;
};

// Trading value calculation
const calculateTradingValue = (branchData) => {
  const rarityScore = calculateRarityScore(branchData);
  let baseValue = Math.floor(rarityScore * 1.5) + Math.floor(branchData.oliveCount * 0.5);
  
  // Boost multipliers
  if (branchData.boostApplied) baseValue *= 1.1;
  if (branchData.seasonalEffect) baseValue *= 1.2;
  if (branchData.seedCategory === 'premium') baseValue *= 1.15;
  if (branchData.seedCategory === 'seasonal') baseValue *= 1.3;
  
  return Math.floor(baseValue);
};

// Export functions
module.exports = {
  // Core generation
  generateOliveBranchData,
  generateOliveBranchSVG,
  generateWithBoosts,
  generatePreviewBranch,
  generateThemedBranch,
  
  // Utility functions
  calculateRarityScore,
  calculateTradingValue,
  getActiveBoosts,
  getUserBoost,
  
  // Constants
  OLIVE_BRANCH_BG_COLOR,
  COLOR_PALETTES,
  RARITY_CONFIG
};