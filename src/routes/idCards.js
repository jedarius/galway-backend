// src/routes/idCards.js
// ID Card Rendering API Routes - Integrates with your existing auth system

const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

// Initialize Prisma client with proper error handling
let prisma;
try {
  prisma = new PrismaClient({
    log: ['error'], // Only log errors to reduce noise
  });
  console.log('✅ Prisma client initialized successfully in idCards routes');
} catch (error) {
  console.error('❌ Failed to initialize Prisma client in idCards routes:', error);
  throw error;
}

console.log('🆔 ID Card routes loaded successfully!');

/**
 * Generate SVG ID card based on role specifications from ID-CARD-Design-readme.md
 * Uses your actual database schema with snake_case field names
 */
const generateIdCardSVG = (userData, isPublicView = false) => {
  const {
    username,
    role,
    created_at, // Your schema uses created_at, not createdAt
    id_no,      // Your schema uses id_no, not idNo
    bio,
    activeOliveBranch
  } = userData;

  // Role-specific styling from your design specs
  const roleStyles = {
    guest: {
      primaryColor: '#393939',
      shadowColor: '#000000',
      roleName: 'guest'
    },
    operative: {
      primaryColor: '#DB52F4',
      shadowColor: '#DB52F4',
      roleName: 'operative'
    },
    contributor: {
      primaryColor: '#D5B504',
      shadowColor: '#D5B504',
      roleName: 'contributor'
    },
    beta_tester: {
      primaryColor: '#0D7F10',
      shadowColor: '#0D7F10',
      roleName: 'beta-tester'
    },
    moderator: {
      primaryColor: '#D40684',
      shadowColor: '#D40684',
      roleName: 'moderator'
    },
    admin: {
      primaryColor: '#FF6B35',
      shadowColor: '#FF6B35',
      roleName: 'admin'
    }
  };

  const currentRole = roleStyles[role] || roleStyles.guest;
  
  // Format date as dd/mm/yyyy (using your created_at field)
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const formattedOnsetDate = formatDate(created_at);
  const displayBio = isPublicView ? (bio || 'member of galway research') : (bio || 'member of galway research');

  // Create the SVG card (CR80 standard: 3.370" × 2.125" = 243 × 153 pixels at 72 DPI)
  const cardWidth = 243;
  const cardHeight = 153;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}" 
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Drop shadow filter -->
    <filter id="dropShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="${currentRole.shadowColor}" 
                    flood-opacity="0.14" />
    </filter>
    
    <!-- IBM Plex Mono font -->
    <style>
      @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500&amp;display=swap');
      .card-text {
        font-family: 'IBM Plex Mono', monospace;
        font-weight: 400;
      }
      .card-text-bold {
        font-family: 'IBM Plex Mono', monospace;
        font-weight: 500;
      }
    </style>
  </defs>

  <!-- Card background with rounded corners -->
  <rect x="0" y="0" width="${cardWidth}" height="${cardHeight}" 
        rx="8" ry="8" fill="white" filter="url(#dropShadow)" />

  <!-- Role color accent strip (left side) -->
  <rect x="0" y="8" width="4" height="${cardHeight - 16}" 
        rx="2" ry="2" fill="${currentRole.primaryColor}" />

  <!-- Profile photo area (square with rounded corners) -->
  <rect x="15" y="15" width="50" height="50" rx="6" ry="6" 
        fill="#f5f5f5" stroke="#e0e0e0" stroke-width="1"/>
  
  ${activeOliveBranch ? `
  <!-- Olive branch display -->
  <g transform="translate(15, 15)">
    <!-- Olive branch placeholder (you can replace with actual SVG from your oliveBranchGenerator) -->
    <rect width="50" height="50" fill="#f5f5f5" rx="4"/>
    <circle cx="25" cy="25" r="3" fill="#6B8E23"/>
    <circle cx="20" cy="20" r="2" fill="#8B4513"/>
    <circle cx="30" cy="30" r="2.5" fill="#2F2F2F"/>
    <text x="25" y="45" text-anchor="middle" class="card-text" font-size="6" fill="#666">
      ${activeOliveBranch.botanical_id}
    </text>
  </g>
  ` : `
  <!-- Default profile placeholder -->
  <circle cx="40" cy="40" r="15" fill="#ddd"/>
  <text x="40" y="44" text-anchor="middle" class="card-text" font-size="8" fill="#666">
    no branch
  </text>
  `}

  <!-- Username -->
  <text x="75" y="25" class="card-text-bold" font-size="11" fill="${currentRole.primaryColor}">
    ${username}
  </text>

  <!-- Role -->
  <text x="75" y="40" class="card-text" font-size="8" fill="#333">
    ${currentRole.roleName}
  </text>

  <!-- Metadata grid (two-column layout) -->
  <g transform="translate(75, 55)">
    <!-- Role label/value -->
    <text x="0" y="0" class="card-text" font-size="7" fill="#666">role</text>
    <text x="140" y="0" text-anchor="end" class="card-text" font-size="7" fill="#333">
      ${currentRole.roleName}
    </text>

    <!-- Onset date label/value -->
    <text x="0" y="12" class="card-text" font-size="7" fill="#666">onset</text>
    <text x="140" y="12" text-anchor="end" class="card-text" font-size="7" fill="#333">
      ${formattedOnsetDate}
    </text>

    <!-- ID number label/value -->
    <text x="0" y="24" class="card-text" font-size="7" fill="#666">id-no</text>
    <text x="140" y="24" text-anchor="end" class="card-text" font-size="7" fill="#333">
      ${id_no}
    </text>
  </g>

  <!-- Bio box (grey background with text) -->
  <rect x="15" y="110" width="${cardWidth - 30}" height="28" 
        rx="4" ry="4" fill="#D3D3D3"/>
  
  <!-- Bio text -->
  <text x="20" y="125" class="card-text" font-size="6" fill="#333">
    ${displayBio.length > 50 ? displayBio.substring(0, 47) + '...' : displayBio}
  </text>

  <!-- Specimen data (if olive branch exists) -->
  ${activeOliveBranch ? `
  <text x="20" y="133" class="card-text" font-size="5" fill="#666">
    specimen data: ${activeOliveBranch.olive_count} olives • ${activeOliveBranch.botanical_id}
  </text>
  ` : ''}

</svg>`;
};

// GET /api/id-cards/me - Generate current user's ID card
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    // Use your actual database schema with snake_case field names
    const user = await prisma.users.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        username: true,
        role: true,
        created_at: true,  // Your schema uses created_at
        id_no: true,       // Your schema uses id_no
        bio: true,
        active_olive_branch_id: true,
        // Include active olive branch if it exists
        olive_branches_users_active_olive_branch_idToolive_branches: {
          select: {
            id: true,
            botanical_id: true,
            olive_count: true,
            olive_type: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Check if user has an ID number assigned
    if (!user.id_no) {
      return res.status(400).json({
        error: 'ID number not assigned. Please contact administration.',
        code: 'MISSING_ID_NUMBER'
      });
    }

    // Add olive branch data to user object for SVG generation
    const userData = {
      ...user,
      activeOliveBranch: user.olive_branches_users_active_olive_branch_idToolive_branches
    };

    const svgContent = generateIdCardSVG(userData, false);

    res.set({
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'private, max-age=3600', // Cache for 1 hour
      'X-Card-Type': 'personal',
      'X-Card-Role': user.role
    });

    res.send(svgContent);

  } catch (error) {
    console.error('🔴 Error generating user ID card:', error);
    next(error);
  }
});

// GET /api/id-cards/user/:id - Get another user's ID card (public view)
router.get('/user/:id', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    if (isNaN(userId)) {
      return res.status(400).json({
        error: 'Invalid user ID',
        code: 'INVALID_USER_ID'
      });
    }

    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        role: true,
        created_at: true,
        id_no: true,
        bio: true,
        active_olive_branch_id: true,
        olive_branches_users_active_olive_branch_idToolive_branches: {
          select: {
            id: true,
            botanical_id: true,
            olive_count: true,
            olive_type: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    if (!user.id_no) {
      return res.status(400).json({
        error: 'User ID card not available',
        code: 'MISSING_ID_NUMBER'
      });
    }

    // Add olive branch data to user object for SVG generation
    const userData = {
      ...user,
      activeOliveBranch: user.olive_branches_users_active_olive_branch_idToolive_branches
    };

    // Public view - limited bio information
    const svgContent = generateIdCardSVG(userData, true);

    res.set({
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=1800', // Cache for 30 minutes
      'X-Card-Type': 'public',
      'X-Card-Role': user.role,
      'X-Username': user.username
    });

    res.send(svgContent);

  } catch (error) {
    console.error('🔴 Error generating public ID card:', error);
    next(error);
  }
});

// GET /api/id-cards/preview/:role - Preview ID card for different roles (testing)
router.get('/preview/:role', requireAuth, requireRole(['admin', 'moderator']), (req, res) => {
  const { role } = req.params;
  
  const validRoles = ['guest', 'operative', 'contributor', 'beta_tester', 'moderator', 'admin'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({
      error: 'Invalid role for preview',
      code: 'INVALID_ROLE'
    });
  }

  // Mock user data for preview
  const mockUser = {
    username: 'preview_user',
    role: role,
    created_at: new Date(),
    id_no: '123456',
    bio: 'this is a preview card for testing purposes',
    activeOliveBranch: {
      id: 1,
      botanical_id: 'OLV-ABC123',
      olive_count: 3,
      olive_type: 'Green Olives'
    }
  };

  const svgContent = generateIdCardSVG(mockUser, false);

  res.set({
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'no-cache',
    'X-Card-Type': 'preview',
    'X-Preview-Role': role
  });

  res.send(svgContent);
});

// GET /api/id-cards/metadata/me - Get current user's card metadata (JSON)
router.get('/metadata/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.users.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        username: true,
        role: true,
        created_at: true,
        id_no: true,
        bio: true,
        olive_branches_users_active_olive_branch_idToolive_branches: {
          select: {
            id: true,
            botanical_id: true,
            olive_count: true,
            olive_type: true,
            count_rarity: true,
            type_rarity: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Format date as dd/mm/yyyy
    const formatDate = (dateString) => {
      const date = new Date(dateString);
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    };

    const activeOliveBranch = user.olive_branches_users_active_olive_branch_idToolive_branches;

    res.json({
      cardData: {
        username: user.username,
        role: user.role,
        onsetDate: formatDate(user.created_at),
        idNo: user.id_no,
        bio: user.bio || 'member of galway research',
        memberSince: formatDate(user.created_at)
      },
      oliveBranch: activeOliveBranch ? {
        id: activeOliveBranch.id,
        botanicalId: activeOliveBranch.botanical_id,
        oliveCount: activeOliveBranch.olive_count,
        oliveType: activeOliveBranch.olive_type,
        countRarity: activeOliveBranch.count_rarity,
        typeRarity: activeOliveBranch.type_rarity,
        specimenData: `${activeOliveBranch.olive_count} olives`,
        botanicalIdShort: activeOliveBranch.botanical_id.split('-')[1] // Last part after dash
      } : null,
      urls: {
        cardSvg: '/api/id-cards/me',
        publicView: `/api/id-cards/user/${user.id}`
      }
    });

  } catch (error) {
    console.error('🔴 Error getting card metadata:', error);
    next(error);
  }
});

// GET /api/id-cards/admin/stats - Check ID assignment status (admin only)
router.get('/admin/stats', requireAuth, requireRole(['admin']), async (req, res, next) => {
  try {
    // Get statistics about ID assignment using your actual schema
    const [totalUsers, usersWithIds, usersWithoutIds] = await Promise.all([
      prisma.users.count(),
      prisma.users.count({
        where: { id_no: { not: null } }
      }),
      prisma.users.count({
        where: { id_no: null }
      })
    ]);
    
    res.json({
      message: 'ID assignment statistics',
      stats: {
        totalUsers,
        usersWithIds,
        usersWithoutIds,
        completionPercentage: totalUsers > 0 ? Math.round((usersWithIds / totalUsers) * 100) : 0
      },
      needsMigration: usersWithoutIds > 0,
      note: "Your auth system already handles ID generation for new users!"
    });
    
  } catch (error) {
    console.error('🔴 Stats error:', error);
    next(error);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🔌 Disconnecting Prisma client from idCards routes...');
  await prisma.$disconnect();
});

process.on('SIGTERM', async () => {
  console.log('🔌 Disconnecting Prisma client from idCards routes...');
  await prisma.$disconnect();
});

module.exports = router;