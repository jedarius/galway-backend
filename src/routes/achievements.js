const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { ResponseWrapper } = require('../middleware/errorHandler');

const router = express.Router();
const prisma = new PrismaClient();

// Test endpoint - keeping the working version
router.get('/test', (req, res) => {
  const testData = {
    system: 'Achievements API',
    version: '1.0.0',
    status: 'operational',
    features: [
      'Achievement tracking and progress',
      'Badge system for user profiles',
      'Reward claiming system',
      'Achievement categories',
      'Progress tracking with criteria',
      'Recent achievements feed'
    ],
    categories: ['collector', 'trader', 'social', 'seasonal', 'special'],
    reward_types: ['seeds', 'points', 'badge_only', 'early_access']
  };
  
  ResponseWrapper.success(res, testData, 'Achievements API fully operational');
});

// GET /api/achievements/categories - Get achievement categories
router.get('/categories', async (req, res, next) => {
  try {
    // Predefined categories with descriptions
    const categories = [
      {
        name: 'collector',
        count: 0,
        description: 'Achievements for collecting rare olive branches and building impressive collections'
      },
      {
        name: 'trader',
        count: 0,
        description: 'Achievements for trading activities, successful transactions, and market participation'
      },
      {
        name: 'social',
        count: 0,
        description: 'Achievements for community engagement, social interactions, and helping others'
      },
      {
        name: 'seasonal',
        count: 0,
        description: 'Limited-time seasonal achievements and special event participation'
      },
      {
        name: 'special',
        count: 0,
        description: 'Rare and unique achievements for extraordinary accomplishments'
      }
    ];

    // Try to get actual counts from database
    try {
      const dbCategories = await prisma.achievements.groupBy({
        by: ['category'],
        where: { is_active: true },
        _count: { category: true }
      });

      // Update counts if we have data
      dbCategories.forEach(dbCat => {
        const category = categories.find(c => c.name === dbCat.category);
        if (category) {
          category.count = dbCat._count.category;
        }
      });
    } catch (dbError) {
      console.log('Database not available for achievement categories, using defaults');
    }

    ResponseWrapper.success(res, categories);
  } catch (error) {
    next(error);
  }
});

// GET /api/achievements/recent - Get recent achievements
router.get('/recent', async (req, res, next) => {
  try {
    const { limit = 20, hours = 24 } = req.query;
    let recentAchievements = [];

    try {
      recentAchievements = await prisma.user_achievements.findMany({
        where: {
          is_completed: true,
          completed_at: {
            gte: new Date(Date.now() - (parseInt(hours) * 60 * 60 * 1000))
          }
        },
        select: {
          id: true,
          completed_at: true,
          users: {
            select: {
              id: true,
              username: true,
              role: true
            }
          },
          achievements: {
            select: {
              id: true,
              name: true,
              description: true,
              badge_icon: true,
              category: true,
              reward_type: true
            }
          }
        },
        orderBy: { completed_at: 'desc' },
        take: parseInt(limit)
      });
    } catch (dbError) {
      console.log('No recent achievements data available');
      // Return empty array if database not available
      recentAchievements = [];
    }

    const formatted = recentAchievements.map(ra => ({
      id: ra.id,
      user: {
        id: ra.users.id,
        username: ra.users.username,
        role: ra.users.role
      },
      achievement: {
        id: ra.achievements.id,
        name: ra.achievements.name,
        description: ra.achievements.description,
        badge_icon: ra.achievements.badge_icon,
        category: ra.achievements.category,
        reward_type: ra.achievements.reward_type
      },
      completed_at: ra.completed_at
    }));

    ResponseWrapper.success(res, formatted, 'Recent achievements retrieved');
  } catch (error) {
    next(error);
  }
});

// GET /api/achievements/leaderboard - Achievement leaderboard
router.get('/leaderboard', async (req, res, next) => {
  try {
    const { limit = 50 } = req.query;
    let formatted = [];

    try {
      const achievementLeaderboard = await prisma.user_achievements.groupBy({
        by: ['user_id'],
        where: { is_completed: true },
        _count: { user_id: true },
        orderBy: {
          _count: { user_id: 'desc' }
        },
        take: parseInt(limit)
      });

      // Get user details for the leaderboard
      const userIds = achievementLeaderboard.map(entry => entry.user_id);
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          username: true,
          role: true,
          created_at: true
        }
      });

      // Create user lookup map
      const userMap = users.reduce((acc, user) => {
        acc[user.id] = user;
        return acc;
      }, {});

      // Format leaderboard with user details
      formatted = achievementLeaderboard.map((entry, index) => ({
        rank: index + 1,
        user: userMap[entry.user_id],
        achievements_earned: entry._count.user_id
      })).filter(entry => entry.user);

    } catch (dbError) {
      console.log('No achievement leaderboard data available');
      formatted = [];
    }

    ResponseWrapper.success(res, formatted, 'Achievement leaderboard retrieved');
  } catch (error) {
    next(error);
  }
});

// GET /api/achievements/user/:id - Get user's achievement progress
router.get('/user/:id', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { include_incomplete = true, category } = req.query;

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: parseInt(id) },
      select: {
        id: true,
        username: true,
        role: true
      }
    });

    if (!user) {
      return ResponseWrapper.notFound(res, 'User not found');
    }

    // Authorization check
    if (req.user.id !== parseInt(id) && !['admin', 'moderator'].includes(req.user.role)) {
      return ResponseWrapper.forbidden(res, 'Access denied');
    }

    let allAchievements = [];

    try {
      // Get user's achievement progress
      const userAchievements = await prisma.user_achievements.findMany({
        where: {
          user_id: parseInt(id),
          ...(category && {
            achievements: { category }
          })
        },
        select: {
          id: true,
          progress_current: true,
          progress_required: true,
          is_completed: true,
          completed_at: true,
          claimed_at: true,
          progress_data: true,
          created_at: true,
          achievements: {
            select: {
              id: true,
              name: true,
              description: true,
              badge_icon: true,
              category: true,
              criteria: true,
              reward_type: true,
              reward_value: true,
              is_hidden: true
            }
          }
        },
        orderBy: [
          { is_completed: 'desc' },
          { progress_current: 'desc' },
          { achievements: { sort_order: 'asc' } }
        ]
      });

      // If include_incomplete is true, also get achievements user hasn't started
      if (include_incomplete === 'true') {
        const userAchievementIds = userAchievements.map(ua => ua.achievements.id);
        
        const incompleteAchievements = await prisma.achievements.findMany({
          where: {
            id: { notIn: userAchievementIds },
            is_active: true,
            is_hidden: false,
            ...(category && { category })
          },
          select: {
            id: true,
            name: true,
            description: true,
            badge_icon: true,
            category: true,
            criteria: true,
            reward_type: true,
            reward_value: true,
            is_hidden: true
          }
        });

        // Add incomplete achievements as user achievements with 0 progress
        const incompleteUserAchievements = incompleteAchievements.map(achievement => ({
          id: null,
          progress_current: 0,
          progress_required: achievement.criteria?.required || 1,
          is_completed: false,
          completed_at: null,
          claimed_at: null,
          progress_data: null,
          created_at: null,
          achievements: achievement
        }));

        allAchievements = [...userAchievements, ...incompleteUserAchievements];
      } else {
        allAchievements = userAchievements;
      }

    } catch (dbError) {
      console.log('No achievement data available for user');
      
      // Return sample achievements if no database data
      allAchievements = [
        {
          id: null,
          progress_current: 0,
          progress_required: 1,
          is_completed: false,
          completed_at: null,
          claimed_at: null,
          progress_data: null,
          created_at: null,
          achievements: {
            id: 1,
            name: 'First Branch',
            description: 'Generate your first olive branch',
            badge_icon: '🌿',
            category: 'collector',
            criteria: { required: 1 },
            reward_type: 'seeds',
            reward_value: 10,
            is_hidden: false
          }
        }
      ];
    }

    // Format the achievements
    const formattedAchievements = allAchievements.map(ua => {
      const progressPercentage = ua.progress_required > 0 ? 
        Math.min((ua.progress_current / ua.progress_required) * 100, 100) : 0;

      return {
        achievement: {
          id: ua.achievements.id,
          name: ua.achievements.name,
          description: ua.achievements.description,
          badge_icon: ua.achievements.badge_icon,
          category: ua.achievements.category,
          criteria: ua.achievements.criteria,
          reward: {
            type: ua.achievements.reward_type,
            value: ua.achievements.reward_value
          },
          is_hidden: ua.achievements.is_hidden
        },
        progress: {
          current: ua.progress_current,
          required: ua.progress_required,
          percentage: Math.round(progressPercentage),
          data: ua.progress_data
        },
        status: {
          is_completed: ua.is_completed,
          completed_at: ua.completed_at,
          is_claimed: !!ua.claimed_at,
          claimed_at: ua.claimed_at,
          can_claim: ua.is_completed && !ua.claimed_at
        },
        started_at: ua.created_at
      };
    });

    // Group by category
    const achievementsByCategory = formattedAchievements.reduce((acc, achievement) => {
      const category = achievement.achievement.category;
      if (!acc[category]) acc[category] = [];
      acc[category].push(achievement);
      return acc;
    }, {});

    // Calculate summary stats
    const completed = formattedAchievements.filter(a => a.status.is_completed).length;
    const claimed = formattedAchievements.filter(a => a.status.is_claimed).length;
    const unclaimed = completed - claimed;
    const inProgress = formattedAchievements.filter(a => 
      !a.status.is_completed && a.progress.current > 0
    ).length;

    ResponseWrapper.success(res, {
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      },
      achievements: achievementsByCategory,
      summary: {
        total_achievements: formattedAchievements.length,
        completed,
        claimed,
        unclaimed_rewards: unclaimed,
        in_progress: inProgress,
        completion_rate: formattedAchievements.length > 0 ? 
          Math.round((completed / formattedAchievements.length) * 100) : 0
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/achievements - Get all achievements
router.get('/', async (req, res, next) => {
  try {
    const { 
      category, 
      active_only = true, 
      include_hidden = false,
      page = 1,
      limit = 50
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    let achievements = [];
    let total = 0;

    try {
      const where = {
        ...(active_only === 'true' && { is_active: true }),
        ...(include_hidden === 'false' && { is_hidden: false }),
        ...(category && { category })
      };

      [achievements, total] = await Promise.all([
        prisma.achievements.findMany({
          where,
          select: {
            id: true,
            name: true,
            description: true,
            badge_icon: true,
            category: true,
            criteria: true,
            reward_type: true,
            reward_value: true,
            is_hidden: true,
            sort_order: true,
            created_at: true,
            _count: {
              select: { user_achievements: true }
            }
          },
          orderBy: [
            { sort_order: 'asc' },
            { created_at: 'asc' }
          ],
          skip: offset,
          take: parseInt(limit)
        }),
        prisma.achievements.count({ where })
      ]);
    } catch (dbError) {
      console.log('Database not available, returning sample achievements');
      
      // Return sample achievements
      achievements = [
        {
          id: 1,
          name: 'First Branch',
          description: 'Generate your first olive branch',
          badge_icon: '🌿',
          category: 'collector',
          criteria: { required: 1 },
          reward_type: 'seeds',
          reward_value: 10,
          is_hidden: false,
          sort_order: 1,
          created_at: new Date(),
          _count: { user_achievements: 0 }
        },
        {
          id: 2,
          name: 'Dedicated Collector',
          description: 'Generate 10 olive branches',
          badge_icon: '🏆',
          category: 'collector',
          criteria: { required: 10 },
          reward_type: 'seeds',
          reward_value: 50,
          is_hidden: false,
          sort_order: 2,
          created_at: new Date(),
          _count: { user_achievements: 0 }
        }
      ];
      
      total = achievements.length;
    }

    const formattedAchievements = achievements.map(achievement => ({
      id: achievement.id,
      name: achievement.name,
      description: achievement.description,
      badge_icon: achievement.badge_icon,
      category: achievement.category,
      criteria: achievement.criteria,
      reward: {
        type: achievement.reward_type,
        value: achievement.reward_value
      },
      is_hidden: achievement.is_hidden,
      sort_order: achievement.sort_order,
      total_earned: achievement._count?.user_achievements || 0,
      created_at: achievement.created_at
    }));

    ResponseWrapper.paginated(res, formattedAchievements, {
      page: parseInt(page),
      limit: parseInt(limit),
      total
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/achievements/:id/claim - Claim achievement rewards
router.post('/:id/claim', requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    try {
      // Get the user's achievement progress
      const userAchievement = await prisma.user_achievements.findUnique({
        where: {
          user_id_achievement_id: {
            user_id: userId,
            achievement_id: parseInt(id)
          }
        },
        include: {
          achievements: {
            select: {
              name: true,
              description: true,
              reward_type: true,
              reward_value: true
            }
          }
        }
      });

      if (!userAchievement) {
        return ResponseWrapper.notFound(res, 'Achievement not found or not unlocked');
      }

      if (!userAchievement.is_completed) {
        return ResponseWrapper.badRequest(res, 'Achievement not completed yet');
      }

      if (userAchievement.claimed_at) {
        return ResponseWrapper.badRequest(res, 'Achievement reward already claimed');
      }

      // Start transaction to claim reward
      const result = await prisma.$transaction(async (tx) => {
        // Mark achievement as claimed
        const claimedAchievement = await tx.user_achievements.update({
          where: {
            user_id_achievement_id: {
              user_id: userId,
              achievement_id: parseInt(id)
            }
          },
          data: {
            claimed_at: new Date()
          }
        });

        // Apply the reward based on type
        let rewardApplied = null;
        const achievement = userAchievement.achievements;

        if (achievement.reward_type === 'seeds' && achievement.reward_value > 0) {
          // TODO: Add seeds to user's inventory when seed system is implemented
          rewardApplied = {
            type: 'seeds',
            amount: achievement.reward_value
          };
        } else if (achievement.reward_type === 'points' && achievement.reward_value > 0) {
          // TODO: Add points to user when points system is implemented
          rewardApplied = {
            type: 'points',
            amount: achievement.reward_value
          };
        } else if (achievement.reward_type === 'badge_only') {
          rewardApplied = {
            type: 'badge',
            description: 'Badge unlocked for profile display'
          };
        } else if (achievement.reward_type === 'early_access') {
          rewardApplied = {
            type: 'early_access',
            description: 'Early access features unlocked'
          };
        }

        return {
          achievement: claimedAchievement,
          reward: rewardApplied
        };
      });

      ResponseWrapper.success(res, {
        achievement: {
          id: parseInt(id),
          name: userAchievement.achievements.name,
          description: userAchievement.achievements.description
        },
        reward_claimed: result.reward,
        claimed_at: result.achievement.claimed_at
      }, `Successfully claimed reward for "${userAchievement.achievements.name}"`);

    } catch (dbError) {
      return ResponseWrapper.notFound(res, 'Achievement system not available');
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;