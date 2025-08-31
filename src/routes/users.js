// routes/users.js - Enhanced User Management with Status System
const express = require('express');
const { body, query, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const AuthMiddleware = require('../middleware/auth');
const { ResponseWrapper, ValidationError, NotFoundError, ForbiddenError } = require('../middleware/errorHandler');

const router = express.Router();
const prisma = new PrismaClient();

console.log('👥 Enhanced User Management routes loaded!');

// Helper function to calculate user activity status
const calculateUserStatus = (user) => {
  const now = new Date();
  const lastSeen = new Date(user.lastSeen);
  const minutesSinceLastSeen = (now - lastSeen) / (1000 * 60);

  if (user.isOnline && minutesSinceLastSeen < 5) {
    return 'online';
  } else if (minutesSinceLastSeen < 15) {
    return 'away';
  } else if (minutesSinceLastSeen < 1440) { // 24 hours
    return 'inactive';
  } else if (minutesSinceLastSeen < 10080) { // 7 days
    return 'dormant';
  } else {
    return 'offline';
  }
};

// Helper function to format user for API response
const formatUserForAPI = (user, includePrivateData = false) => {
  const status = calculateUserStatus(user);
  
  const baseUser = {
    username: user.username,
    role: user.role,
    country: user.country,
    status,
    lastSeen: user.lastSeen,
    joinedDate: user.createdAt,
    isOnline: user.isOnline,
    branch: user.branch
  };

  // Add item count from inventory
  if (user.inventoryItems) {
    baseUser.itemCount = user.inventoryItems.length;
  }

  // Add olive branch info if available
  if (user.activeOliveBranch) {
    baseUser.activeOliveBranch = {
      id: user.activeOliveBranch.id,
      botanicalId: user.activeOliveBranch.botanicalId,
      oliveType: user.activeOliveBranch.oliveType,
      svgUrl: `/api/olive-branches/${user.activeOliveBranch.id}/svg`
    };
  }

  // Include private data for own profile or admin access
  if (includePrivateData) {
    baseUser.id = user.id;
    baseUser.idNo = user.idNo;
    baseUser.email = user.email;
    baseUser.botanicalSignature = {
      oliveCount: user.activeOliveBranch?.oliveCount || 0,
      oliveType: user.activeOliveBranch?.oliveType || 'none',
      countRarity: user.activeOliveBranch?.countRarity || 'none',
      typeRarity: user.activeOliveBranch?.typeRarity || 'none'
    };
  }

  return baseUser;
};

// GET /api/users - Enhanced user listing with filtering
router.get('/',
  AuthMiddleware.requireAuth,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
    query('role').optional().isIn(['operative', 'contributor', 'moderator', 'beta_tester', 'admin']),
    query('status').optional().isIn(['online', 'away', 'inactive', 'dormant', 'offline']),
    query('search').optional().isLength({ min: 1, max: 50 }).withMessage('Search must be 1-50 characters'),
    query('sortBy').optional().isIn(['username', 'lastSeen', 'createdAt', 'role']),
    query('sortOrder').optional().isIn(['asc', 'desc'])
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Invalid query parameters', errors.array());
      }

      const {
        page = 1,
        limit = 20,
        role,
        status,
        search,
        sortBy = 'lastSeen',
        sortOrder = 'desc'
      } = req.query;

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const offset = (pageNum - 1) * limitNum;

      // Build where clause
      const where = {
        isActive: true
      };

      if (role) {
        where.role = role;
      }

      if (search) {
        where.username = {
          contains: search,
          mode: 'insensitive'
        };
      }

      // Get users with related data
      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          skip: offset,
          take: limitNum,
          select: {
            id: true,
            username: true,
            role: true,
            country: true,
            lastSeen: true,
            isOnline: true,
            createdAt: true,
            branch: true,
            activeOliveBranch: {
              select: {
                id: true,
                botanicalId: true,
                oliveType: true,
                oliveCount: true,
                countRarity: true,
                typeRarity: true
              }
            },
            inventoryItems: {
              select: {
                id: true
              }
            }
          }
        }),
        prisma.user.count({ where })
      ]);

      // Filter by status if requested (post-query filtering since it's calculated)
      let filteredUsers = users;
      if (status) {
        filteredUsers = users.filter(user => calculateUserStatus(user) === status);
      }

      // Format users for response
      const formattedUsers = filteredUsers.map(user => formatUserForAPI(user));

      // Get available filter options for frontend
      const [roleBreakdown, statusBreakdown] = await Promise.all([
        prisma.user.groupBy({
          by: ['role'],
          where: { isActive: true },
          _count: { role: true }
        }),
        // Status breakdown requires post-processing since it's calculated
        Promise.resolve(users.reduce((acc, user) => {
          const userStatus = calculateUserStatus(user);
          acc[userStatus] = (acc[userStatus] || 0) + 1;
          return acc;
        }, {}))
      ]);

      return ResponseWrapper.success(res, {
        users: formattedUsers,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: status ? filteredUsers.length : total,
          totalPages: Math.ceil((status ? filteredUsers.length : total) / limitNum),
          hasNext: pageNum < Math.ceil((status ? filteredUsers.length : total) / limitNum),
          hasPrev: pageNum > 1
        },
        filters: {
          roles: roleBreakdown.map(r => ({ role: r.role, count: r._count.role })),
          statuses: Object.entries(statusBreakdown).map(([status, count]) => ({ status, count })),
          currentFilters: {
            role: role || null,
            status: status || null,
            search: search || null,
            sortBy,
            sortOrder
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// GET /api/users/:username - Get specific user profile
router.get('/:username',
  AuthMiddleware.requireAuth,
  async (req, res, next) => {
    try {
      const { username } = req.params;

      const user = await prisma.user.findUnique({
        where: { username },
        select: {
          id: true,
          username: true,
          role: true,
          country: true,
          lastSeen: true,
          isOnline: true,
          createdAt: true,
          branch: true,
          idNo: true,
          email: true,
          activeOliveBranch: {
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
          },
          inventoryItems: {
            where: {
              itemType: { in: ['branch', 'item', 'achievement'] }
            },
            orderBy: { gridPosition: 'asc' },
            take: 4, // Display slots
            select: {
              id: true,
              itemType: true,
              itemId: true,
              quantity: true,
              gridPosition: true,
              oliveBranch: {
                select: {
                  id: true,
                  botanicalId: true,
                  oliveType: true,
                  countRarity: true,
                  typeRarity: true
                }
              }
            }
          },
          _count: {
            select: {
              inventoryItems: true,
              oliveBranches: {
                where: { isActive: true }
              }
            }
          }
        }
      });

      if (!user) {
        throw new NotFoundError('User not found');
      }

      // Check permissions for private data
      const isOwnProfile = req.user.username === username;
      const isAdmin = req.user.role === 'admin';
      const canViewPrivateData = isOwnProfile || isAdmin;

      const formattedUser = formatUserForAPI(user, canViewPrivateData);

      // Add detailed inventory and stats for profile view
      const profileData = {
        profile: formattedUser,
        stats: {
          totalItems: user._count.inventoryItems,
          totalBranches: user._count.oliveBranches,
          itemsDisplayed: user.inventoryItems.filter(item => item.gridPosition < 4).length,
          collectionValue: user.inventoryItems.length * 10 // Simplified calculation
        },
        displayInventory: user.inventoryItems.map(item => ({
          id: item.id,
          type: item.itemType,
          quantity: item.quantity,
          gridPosition: item.gridPosition,
          // Add specific data based on item type
          ...(item.itemType === 'branch' && item.oliveBranch ? {
            botanicalId: item.oliveBranch.botanicalId,
            oliveType: item.oliveBranch.oliveType,
            rarity: `${item.oliveBranch.countRarity} / ${item.oliveBranch.typeRarity}`,
            icon: '🌿'
          } : {
            icon: item.itemType === 'item' ? '📦' : '🏆'
          })
        })),
        permissions: {
          canEdit: isOwnProfile,
          canViewInventory: canViewPrivateData,
          canMessage: !isOwnProfile && req.user.role !== 'guest'
        }
      };

      return ResponseWrapper.success(res, profileData);

    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/users/:username/status - Update user status (admin only)
router.put('/:username/status',
  AuthMiddleware.requireAuth,
  AuthMiddleware.requireRole(['admin', 'moderator']),
  [
    body('isActive').isBoolean().withMessage('isActive must be a boolean'),
    body('reason').optional().isLength({ min: 1, max: 200 }).withMessage('Reason must be 1-200 characters')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Invalid request data', errors.array());
      }

      const { username } = req.params;
      const { isActive, reason } = req.body;

      const user = await prisma.user.findUnique({
        where: { username },
        select: { id: true, username: true, role: true, isActive: true }
      });

      if (!user) {
        throw new NotFoundError('User not found');
      }

      // Prevent non-admin from modifying admin accounts
      if (user.role === 'admin' && req.user.role !== 'admin') {
        throw new ForbiddenError('Cannot modify administrator accounts');
      }

      const updatedUser = await prisma.user.update({
        where: { username },
        data: { 
          isActive,
          // Add audit log entry
          auditLog: {
            create: {
              action: isActive ? 'account_activated' : 'account_suspended',
              performedBy: req.user.id,
              reason: reason || 'No reason provided',
              timestamp: new Date()
            }
          }
        },
        select: {
          username: true,
          role: true,
          isActive: true,
          lastSeen: true
        }
      });

      return ResponseWrapper.success(res, {
        user: updatedUser,
        action: isActive ? 'activated' : 'suspended'
      }, `User ${username} ${isActive ? 'activated' : 'suspended'} successfully`);

    } catch (error) {
      next(error);
    }
  }
);

// GET /api/users/stats/overview - System user statistics
router.get('/stats/overview',
  AuthMiddleware.requireAuth,
  AuthMiddleware.requireRole(['admin', 'moderator']),
  async (req, res, next) => {
    try {
      const [
        totalUsers,
        activeUsers,
        onlineUsers,
        newUsersThisWeek,
        roleBreakdown
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isActive: true } }),
        prisma.user.count({ 
          where: { 
            isOnline: true,
            lastSeen: { gte: new Date(Date.now() - 15 * 60 * 1000) } // Last 15 minutes
          } 
        }),
        prisma.user.count({ 
          where: { 
            createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
          } 
        }),
        prisma.user.groupBy({
          by: ['role'],
          _count: { role: true }
        })
      ]);

      // Get activity trends for the last 7 days
      const activityTrends = await Promise.all(
        Array.from({ length: 7 }, (_, i) => {
          const date = new Date();
          date.setDate(date.getDate() - i);
          const startOfDay = new Date(date.setHours(0, 0, 0, 0));
          const endOfDay = new Date(date.setHours(23, 59, 59, 999));
          
          return prisma.user.count({
            where: {
              lastSeen: {
                gte: startOfDay,
                lte: endOfDay
              }
            }
          }).then(count => ({
            date: startOfDay.toISOString().split('T')[0],
            activeUsers: count
          }));
        })
      );

      return ResponseWrapper.success(res, {
        overview: {
          totalUsers,
          activeUsers,
          onlineUsers,
          newUsersThisWeek,
          activityRate: totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0
        },
        breakdown: {
          byRole: roleBreakdown.map(r => ({ role: r.role, count: r._count.role })),
          byStatus: {
            active: activeUsers,
            suspended: totalUsers - activeUsers,
            online: onlineUsers
          }
        },
        trends: {
          dailyActivity: activityTrends.reverse() // Most recent first
        }
      });

    } catch (error) {
      next(error);
    }
  }
);

// POST /api/users/batch - Bulk user operations (admin only)
router.post('/batch',
  AuthMiddleware.requireAuth,
  AuthMiddleware.requireRole(['admin']),
  [
    body('action').isIn(['activate', 'suspend', 'delete', 'update_role']).withMessage('Invalid action'),
    body('userIds').isArray({ min: 1 }).withMessage('userIds must be a non-empty array'),
    body('userIds.*').isInt({ min: 1 }).withMessage('Each userId must be a positive integer'),
    body('data').optional().isObject().withMessage('data must be an object'),
    body('reason').optional().isLength({ min: 1, max: 200 }).withMessage('Reason must be 1-200 characters')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Invalid request data', errors.array());
      }

      const { action, userIds, data, reason } = req.body;

      // Verify all users exist
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, role: true }
      });

      if (users.length !== userIds.length) {
        throw new NotFoundError('One or more users not found');
      }

      let updateData = {};
      let auditAction = action;

      switch (action) {
        case 'activate':
          updateData = { isActive: true };
          break;
        case 'suspend':
          updateData = { isActive: false };
          break;
        case 'update_role':
          if (!data?.role) {
            throw new ValidationError('Role is required for update_role action');
          }
          updateData = { role: data.role };
          auditAction = `role_changed_to_${data.role}`;
          break;
        case 'delete':
          // Soft delete - mark as inactive and scramble username
          updateData = { 
            isActive: false, 
            username: (username) => `deleted_${username}_${Date.now()}`
          };
          break;
      }

      // Perform bulk update
      const results = await prisma.$transaction(
        userIds.map(userId => 
          prisma.user.update({
            where: { id: userId },
            data: updateData,
            select: { id: true, username: true, role: true, isActive: true }
          })
        )
      );

      // Create audit log entries
      await prisma.auditLog.createMany({
        data: userIds.map(userId => ({
          userId,
          action: auditAction,
          performedBy: req.user.id,
          reason: reason || `Bulk ${action}`,
          timestamp: new Date()
        }))
      });

      return ResponseWrapper.success(res, {
        action,
        affected: results.length,
        users: results
      }, `Bulk ${action} completed successfully`);

    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;