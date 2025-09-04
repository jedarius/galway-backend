// routes/forum.js - Complete Forum API Implementation
const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const AuthMiddleware = require('../middleware/auth');
const { ResponseWrapper, ValidationError, NotFoundError, ForbiddenError } = require('../middleware/errorHandler');
const contentModeration = require('../middleware/contentModeration');
const fileUpload = require('../middleware/fileUpload');

const router = express.Router();
const prisma = new PrismaClient();

console.log('💬 Forum API routes loaded!');

// Helper function to create URL-friendly slugs
const createSlug = (title) => {
  return title
    .toLowerCase()
    .replace(/[^\w ]+/g, '')
    .replace(/ +/g, '-')
    .substring(0, 50);
};

// Helper function to check if thread is auto-locked (15 days of inactivity)
const isThreadAutoLocked = (lastActivityAt) => {
  const fifteenDaysAgo = new Date();
  fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15);
  return lastActivityAt < fifteenDaysAgo;
};

// Helper function to get post limits based on role
const getPostLimits = (role) => {
  const limits = {
    operative: 5,
    contributor: 10,
    beta_tester: 15,
    moderator: 999,
    admin: 999
  };
  return limits[role] || limits.operative;
};

// =================================
// CATEGORY ROUTES
// =================================

// GET /api/forum/categories - List all forum categories
router.get('/categories',
  AuthMiddleware.requireAuth,
  async (req, res, next) => {
    try {
      const categories = await prisma.forum_categories.findMany({
        where: { 
          is_active: true,
          min_role_to_view: {
            in: req.user.role === 'admin' ? undefined : 
                ['operative', 'contributor', 'beta_tester', 'moderator', 'admin']
          }
        },
        orderBy: { sort_order: 'asc' },
        select: {
          id: true,
          name: true,
          description: true,
          sort_order: true,
          min_role_to_view: true,
          min_role_to_post: true,
          _count: {
            select: {
              forum_threads: {
                where: { is_deleted: false }
              }
            }
          }
        }
      });

      // Calculate latest activity for each category
      const categoriesWithActivity = await Promise.all(
        categories.map(async (category) => {
          const latestThread = await prisma.forum_threads.findFirst({
            where: {
              category_id: category.id,
              is_deleted: false
            },
            orderBy: { last_activity_at: 'desc' },
            select: {
              id: true,
              title: true,
              last_activity_at: true,
              users_forum_threads_author_idTousers: {
                select: { username: true }
              }
            }
          });

          return {
            ...category,
            thread_count: category._count.forum_threads,
            latest_thread: latestThread,
            can_post: ['moderator', 'admin'].includes(req.user.role) || 
                     req.user.role === category.min_role_to_post ||
                     ['operative', 'contributor', 'beta_tester'].includes(req.user.role)
          };
        })
      );

      delete categoriesWithActivity._count;

      return ResponseWrapper.success(res, {
        categories: categoriesWithActivity,
        user_permissions: {
          can_create_category: ['admin'].includes(req.user.role),
          can_moderate: ['moderator', 'admin'].includes(req.user.role)
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/forum/categories - Create new category (Admin only)
router.post('/categories',
  AuthMiddleware.requireAuth,
  AuthMiddleware.requireRole(['admin']),
  [
    body('name').isLength({ min: 1, max: 100 }).withMessage('Name must be 1-100 characters'),
    body('description').optional().isLength({ max: 500 }).withMessage('Description max 500 characters'),
    body('sort_order').optional().isInt({ min: 0 }).withMessage('Sort order must be non-negative integer'),
    body('min_role_to_view').optional().isIn(['operative', 'contributor', 'beta_tester', 'moderator', 'admin']),
    body('min_role_to_post').optional().isIn(['operative', 'contributor', 'beta_tester', 'moderator', 'admin'])
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const { name, description, sort_order = 0, min_role_to_view = 'operative', min_role_to_post = 'operative' } = req.body;

      const category = await prisma.forum_categories.create({
        data: {
          name,
          description,
          sort_order,
          min_role_to_view,
          min_role_to_post,
          is_active: true
        }
      });

      return ResponseWrapper.created(res, category, 'Category created successfully');
    } catch (error) {
      next(error);
    }
  }
);

// =================================
// THREAD ROUTES
// =================================

// GET /api/forum/categories/:categoryId/threads - List threads in category
router.get('/categories/:categoryId/threads',
  AuthMiddleware.requireAuth,
  [
    param('categoryId').isInt({ min: 1 }).withMessage('Invalid category ID'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be 1-50'),
    query('sort').optional().isIn(['newest', 'oldest', 'most_replies', 'last_activity']),
    query('search').optional().isLength({ min: 1, max: 100 }).withMessage('Search must be 1-100 characters')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const { categoryId } = req.params;
      const { 
        page = 1, 
        limit = 20, 
        sort = 'last_activity',
        search 
      } = req.query;

      // Check if category exists and user can view it
      const category = await prisma.forum_categories.findUnique({
        where: { 
          id: parseInt(categoryId),
          is_active: true
        }
      });

      if (!category) {
        throw new NotFoundError('Category not found');
      }

      // Build where clause for threads
      const where = {
        category_id: parseInt(categoryId),
        is_deleted: false
      };

      if (search) {
        where.title = {
          contains: search,
          mode: 'insensitive'
        };
      }

      // Define sort options
      const sortOptions = {
        newest: { created_at: 'desc' },
        oldest: { created_at: 'asc' },
        most_replies: { reply_count: 'desc' },
        last_activity: { last_activity_at: 'desc' }
      };

      const offset = (parseInt(page) - 1) * parseInt(limit);

      const [threads, total] = await Promise.all([
        prisma.forum_threads.findMany({
          where,
          orderBy: sortOptions[sort] || sortOptions.last_activity,
          skip: offset,
          take: parseInt(limit),
          select: {
            id: true,
            title: true,
            slug: true,
            is_pinned: true,
            is_locked: true,
            reply_count: true,
            last_activity_at: true,
            created_at: true,
            users_forum_threads_author_idTousers: {
              select: {
                username: true,
                role: true
              }
            },
            users_forum_threads_last_reply_byTousers: {
              select: {
                username: true
              }
            }
          }
        }),
        prisma.forum_threads.count({ where })
      ]);

      // Check which threads are auto-locked and add verification status
      const threadsWithStatus = await Promise.all(threads.map(async (thread) => {
        const autoLocked = isThreadAutoLocked(thread.last_activity_at);
        
        // Check if thread is verified study (has star)
        const firstPost = await prisma.forum_posts.findFirst({
          where: {
            thread_id: thread.id,
            is_first_post: true
          },
          select: {
            id: true,
            // We'll add a verified_study field later via admin action
          }
        });

        return {
          ...thread,
          is_auto_locked: autoLocked,
          is_effectively_locked: thread.is_locked || autoLocked,
          is_verified_study: false, // TODO: Add this field to posts table
          author: thread.users_forum_threads_author_idTousers,
          last_reply_by: thread.users_forum_threads_last_reply_byTousers
        };
      }));

      // Remove nested user objects
      threadsWithStatus.forEach(thread => {
        delete thread.users_forum_threads_author_idTousers;
        delete thread.users_forum_threads_last_reply_byTousers;
      });

      return ResponseWrapper.paginated(res, threadsWithStatus, {
        page: parseInt(page),
        limit: parseInt(limit),
        total
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/forum/categories/:categoryId/threads - Create new thread
router.post('/categories/:categoryId/threads',
  AuthMiddleware.requireAuth,
  fileUpload.array('attachments', 3), // Max 3 files
  [
    param('categoryId').isInt({ min: 1 }).withMessage('Invalid category ID'),
    body('title').isLength({ min: 1, max: 200 }).withMessage('Title must be 1-200 characters'),
    body('content').isLength({ min: 1, max: 5000 }).withMessage('Content must be 1-5000 characters')
  ],
  contentModeration.filterContent,
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const { categoryId } = req.params;
      const { title, content } = req.body;
      const userId = req.user.id;

      // Check daily post limit
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todaysThreads = await prisma.forum_threads.count({
        where: {
          author_id: userId,
          created_at: { gte: today }
        }
      });

      const postLimit = getPostLimits(req.user.role);
      if (todaysThreads >= postLimit) {
        throw new ForbiddenError(`Daily thread limit reached (${postLimit})`);
      }

      // Check if category exists and user can post
      const category = await prisma.forum_categories.findUnique({
        where: { 
          id: parseInt(categoryId),
          is_active: true
        }
      });

      if (!category) {
        throw new NotFoundError('Category not found');
      }

      // Generate unique slug
      let slug = createSlug(title);
      let slugCount = 0;
      let finalSlug = slug;
      
      while (true) {
        const existingSlug = await prisma.forum_threads.findUnique({
          where: { slug: finalSlug }
        });
        
        if (!existingSlug) break;
        
        slugCount++;
        finalSlug = `${slug}-${slugCount}`;
      }

      // Create thread and first post in transaction
      const result = await prisma.$transaction(async (tx) => {
        // Create thread
        const thread = await tx.forum_threads.create({
          data: {
            category_id: parseInt(categoryId),
            title,
            slug: finalSlug,
            author_id: userId,
            reply_count: 0,
            last_activity_at: new Date(),
            last_reply_by: userId
          }
        });

        // Create first post
        const firstPost = await tx.forum_posts.create({
          data: {
            thread_id: thread.id,
            content: req.filteredContent || content, // Use filtered content
            author_id: userId,
            is_first_post: true
          }
        });

        return { thread, firstPost };
      });

      // Process file attachments if any
      let attachments = [];
      if (req.files && req.files.length > 0) {
        // TODO: Save file info to database and return file URLs
        attachments = req.files.map(file => ({
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          url: `/uploads/${file.filename}`
        }));
      }

      return ResponseWrapper.created(res, {
        thread: {
          id: result.thread.id,
          title: result.thread.title,
          slug: result.thread.slug,
          category_id: result.thread.category_id,
          created_at: result.thread.created_at,
          url: `/forum/thread/${result.thread.slug}`
        },
        post: {
          id: result.firstPost.id,
          content: result.firstPost.content,
          created_at: result.firstPost.created_at
        },
        attachments,
        moderation: {
          auto_flagged: req.autoFlagged || false,
          filtered_content: !!req.filteredContent
        }
      }, 'Thread created successfully');
    } catch (error) {
      next(error);
    }
  }
);

// =================================
// INDIVIDUAL THREAD ROUTES  
// =================================

// GET /api/forum/thread/:slug - Get thread with posts
router.get('/thread/:slug',
  AuthMiddleware.requireAuth,
  [
    param('slug').isLength({ min: 1, max: 250 }).withMessage('Invalid slug'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be 1-50')
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const { slug } = req.params;
      const { page = 1, limit = 20 } = req.query;

      // Get thread with category info
      const thread = await prisma.forum_threads.findUnique({
        where: { 
          slug,
          is_deleted: false
        },
        select: {
          id: true,
          title: true,
          slug: true,
          category_id: true,
          is_pinned: true,
          is_locked: true,
          reply_count: true,
          last_activity_at: true,
          created_at: true,
          users_forum_threads_author_idTousers: {
            select: {
              username: true,
              role: true,
              active_olive_branch_id: true
            }
          },
          forum_categories: {
            select: {
              name: true,
              id: true
            }
          }
        }
      });

      if (!thread) {
        throw new NotFoundError('Thread not found');
      }

      // Get posts with pagination
      const offset = (parseInt(page) - 1) * parseInt(limit);
      
      const [posts, totalPosts] = await Promise.all([
        prisma.forum_posts.findMany({
          where: {
            thread_id: thread.id,
            is_deleted: false
          },
          orderBy: { created_at: 'asc' },
          skip: offset,
          take: parseInt(limit),
          select: {
            id: true,
            content: true,
            is_first_post: true,
            created_at: true,
            edited_at: true,
            users_forum_posts_author_idTousers: {
              select: {
                username: true,
                role: true,
                active_olive_branch_id: true,
                created_at: true
              }
            },
            users_forum_posts_edited_byTousers: {
              select: {
                username: true
              }
            }
          }
        }),
        prisma.forum_posts.count({
          where: {
            thread_id: thread.id,
            is_deleted: false
          }
        })
      ]);

      // Get post votes/upvotes for each post
      const postsWithVotes = await Promise.all(posts.map(async (post) => {
        // TODO: Implement upvote system - for now return 0
        const upvotes = 0;
        const userHasUpvoted = false;

        return {
          id: post.id,
          content: post.content,
          is_first_post: post.is_first_post,
          created_at: post.created_at,
          edited_at: post.edited_at,
          upvotes,
          user_has_upvoted: userHasUpvoted,
          author: {
            username: post.users_forum_posts_author_idTousers.username,
            role: post.users_forum_posts_author_idTousers.role,
            member_since: post.users_forum_posts_author_idTousers.created_at,
            has_olive_branch: !!post.users_forum_posts_author_idTousers.active_olive_branch_id
          },
          edited_by: post.users_forum_posts_edited_byTousers?.username || null,
          can_edit: post.users_forum_posts_author_idTousers.username === req.user.username || 
                   ['moderator', 'admin'].includes(req.user.role),
          can_delete: post.users_forum_posts_author_idTousers.username === req.user.username || 
                     ['moderator', 'admin'].includes(req.user.role)
        };
      }));

      // Check if thread is effectively locked
      const autoLocked = isThreadAutoLocked(thread.last_activity_at);
      const effectivelyLocked = thread.is_locked || autoLocked;

      return ResponseWrapper.success(res, {
        thread: {
          id: thread.id,
          title: thread.title,
          slug: thread.slug,
          category: {
            id: thread.forum_categories.id,
            name: thread.forum_categories.name
          },
          is_pinned: thread.is_pinned,
          is_locked: thread.is_locked,
          is_auto_locked: autoLocked,
          is_effectively_locked: effectivelyLocked,
          reply_count: thread.reply_count,
          last_activity_at: thread.last_activity_at,
          created_at: thread.created_at,
          author: {
            username: thread.users_forum_threads_author_idTousers.username,
            role: thread.users_forum_threads_author_idTousers.role,
            has_olive_branch: !!thread.users_forum_threads_author_idTousers.active_olive_branch_id
          }
        },
        posts: postsWithVotes,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalPosts,
          totalPages: Math.ceil(totalPosts / parseInt(limit)),
          hasNext: parseInt(page) < Math.ceil(totalPosts / parseInt(limit)),
          hasPrev: parseInt(page) > 1
        },
        permissions: {
          can_reply: !effectivelyLocked,
          can_lock: ['moderator', 'admin'].includes(req.user.role),
          can_pin: ['moderator', 'admin'].includes(req.user.role),
          can_delete: thread.users_forum_threads_author_idTousers.username === req.user.username || 
                     ['moderator', 'admin'].includes(req.user.role),
          can_verify_study: ['moderator', 'admin'].includes(req.user.role)
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/forum/thread/:slug/reply - Add reply to thread
router.post('/thread/:slug/reply',
  AuthMiddleware.requireAuth,
  fileUpload.array('attachments', 3),
  [
    param('slug').isLength({ min: 1, max: 250 }).withMessage('Invalid slug'),
    body('content').isLength({ min: 1, max: 1200 }).withMessage('Content must be 1-1200 characters')
  ],
  contentModeration.filterContent,
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const { slug } = req.params;
      const { content } = req.body;
      const userId = req.user.id;

      // Get thread and check if it's locked
      const thread = await prisma.forum_threads.findUnique({
        where: { 
          slug,
          is_deleted: false
        }
      });

      if (!thread) {
        throw new NotFoundError('Thread not found');
      }

      const autoLocked = isThreadAutoLocked(thread.last_activity_at);
      if (thread.is_locked || autoLocked) {
        throw new ForbiddenError('Thread is locked');
      }

      // Create reply and update thread in transaction
      const result = await prisma.$transaction(async (tx) => {
        const post = await tx.forum_posts.create({
          data: {
            thread_id: thread.id,
            content: req.filteredContent || content,
            author_id: userId,
            is_first_post: false
          }
        });

        // Update thread stats
        await tx.forum_threads.update({
          where: { id: thread.id },
          data: {
            reply_count: { increment: 1 },
            last_activity_at: new Date(),
            last_reply_by: userId
          }
        });

        return post;
      });

      // Process attachments
      let attachments = [];
      if (req.files && req.files.length > 0) {
        attachments = req.files.map(file => ({
          filename: file.filename,
          originalName: file.originalname,
          size: file.size,
          mimetype: file.mimetype,
          url: `/uploads/${file.filename}`
        }));
      }

      return ResponseWrapper.created(res, {
        post: {
          id: result.id,
          content: result.content,
          created_at: result.created_at,
          author: {
            username: req.user.username,
            role: req.user.role
          }
        },
        attachments,
        moderation: {
          auto_flagged: req.autoFlagged || false,
          filtered_content: !!req.filteredContent
        }
      }, 'Reply posted successfully');
    } catch (error) {
      next(error);
    }
  }
);

// =================================
// POST MANAGEMENT ROUTES
// =================================

// PUT /api/forum/posts/:postId - Edit post
router.put('/posts/:postId',
  AuthMiddleware.requireAuth,
  [
    param('postId').isInt({ min: 1 }).withMessage('Invalid post ID'),
    body('content').isLength({ min: 1, max: 5000 }).withMessage('Content must be 1-5000 characters')
  ],
  contentModeration.filterContent,
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const { postId } = req.params;
      const { content } = req.body;
      const userId = req.user.id;

      // Get post with author info
      const post = await prisma.forum_posts.findUnique({
        where: { 
          id: parseInt(postId),
          is_deleted: false
        },
        select: {
          id: true,
          thread_id: true,
          content: true,
          author_id: true,
          is_first_post: true,
          users_forum_posts_author_idTousers: {
            select: { username: true }
          }
        }
      });

      if (!post) {
        throw new NotFoundError('Post not found');
      }

      // Check permissions
      const canEdit = post.author_id === userId || ['moderator', 'admin'].includes(req.user.role);
      if (!canEdit) {
        throw new ForbiddenError('Cannot edit this post');
      }

      // Update post
      const updatedPost = await prisma.forum_posts.update({
        where: { id: parseInt(postId) },
        data: {
          content: req.filteredContent || content,
          edited_at: new Date(),
          edited_by: userId
        },
        select: {
          id: true,
          content: true,
          edited_at: true,
          users_forum_posts_edited_byTousers: {
            select: { username: true }
          }
        }
      });

      return ResponseWrapper.updated(res, {
        post: {
          id: updatedPost.id,
          content: updatedPost.content,
          edited_at: updatedPost.edited_at,
          edited_by: updatedPost.users_forum_posts_edited_byTousers.username
        },
        moderation: {
          filtered_content: !!req.filteredContent
        }
      }, 'Post updated successfully');
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/forum/posts/:postId - Delete post
router.delete('/posts/:postId',
  AuthMiddleware.requireAuth,
  [param('postId').isInt({ min: 1 }).withMessage('Invalid post ID')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      const { postId } = req.params;
      const userId = req.user.id;

      const post = await prisma.forum_posts.findUnique({
        where: { 
          id: parseInt(postId),
          is_deleted: false
        },
        select: {
          id: true,
          thread_id: true,
          author_id: true,
          is_first_post: true
        }
      });

      if (!post) {
        throw new NotFoundError('Post not found');
      }

      const canDelete = post.author_id === userId || ['moderator', 'admin'].includes(req.user.role);
      if (!canDelete) {
        throw new ForbiddenError('Cannot delete this post');
      }

      if (post.is_first_post) {
        throw new ForbiddenError('Cannot delete the first post of a thread');
      }

      // Soft delete post and update thread count
      await prisma.$transaction(async (tx) => {
        await tx.forum_posts.update({
          where: { id: parseInt(postId) },
          data: { is_deleted: true }
        });

        await tx.forum_threads.update({
          where: { id: post.thread_id },
          data: { reply_count: { decrement: 1 } }
        });
      });

      return ResponseWrapper.deleted(res, 'Post deleted successfully');
    } catch (error) {
      next(error);
    }
  }
);

// =================================
// UPVOTE SYSTEM ROUTES
// =================================

// POST /api/forum/posts/:postId/upvote - Upvote a post
router.post('/posts/:postId/upvote',
  AuthMiddleware.requireAuth,
  [param('postId').isInt({ min: 1 }).withMessage('Invalid post ID')],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Validation failed', errors.array());
      }

      // TODO: Implement upvote system with post_votes table
      // For now, return placeholder response
      
      return ResponseWrapper.success(res, {
        upvoted: true,
        total_upvotes: 1,
        message: 'Upvote feature coming soon!'
      });
    } catch (error) {
      next(error);
    }
  }
);

// =================================
// MODERATION ROUTES (Mods/Admins)
// =================================

// POST /api/forum/thread/:threadId/verify - Verify study and promote user
router.post('/thread/:threadId/verify',
  AuthMiddleware.requireAuth,
  AuthMiddleware.requireRole(['moderator', 'admin']),
  [param('threadId').isInt({ min: 1 }).withMessage('Invalid thread ID')],
  async (req, res, next) => {
    try {
      const { threadId } = req.params;

      // Get thread with author info
      const thread = await prisma.forum_threads.findUnique({
        where: { id: parseInt(threadId) },
        select: {
          id: true,
          author_id: true,
          title: true,
          users_forum_threads_author_idTousers: {
            select: {
              username: true,
              role: true
            }
          }
        }
      });

      if (!thread) {
        throw new NotFoundError('Thread not found');
      }

      // Update user role to contributor if they're currently operative
      let roleUpdated = false;
      if (thread.users_forum_threads_author_idTousers.role === 'operative') {
        await prisma.users.update({
          where: { id: thread.author_id },
          data: { role: 'contributor' }
        });
        roleUpdated = true;
      }

      // TODO: Add verified_study field to forum_posts table and mark first post as verified

      return ResponseWrapper.success(res, {
        verified: true,
        thread: {
          id: thread.id,
          title: thread.title
        },
        author: {
          username: thread.users_forum_threads_author_idTousers.username,
          old_role: thread.users_forum_threads_author_idTousers.role,
          new_role: roleUpdated ? 'contributor' : thread.users_forum_threads_author_idTousers.role,
          promoted: roleUpdated
        }
      }, `Study verified${roleUpdated ? ' and user promoted to contributor' : ''}`);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/forum/thread/:threadId/lock - Lock/unlock thread
router.put('/thread/:threadId/lock',
  AuthMiddleware.requireAuth,
  AuthMiddleware.requireRole(['moderator', 'admin']),
  [
    param('threadId').isInt({ min: 1 }).withMessage('Invalid thread ID'),
    body('locked').isBoolean().withMessage('Locked must be boolean'),
    body('reason').optional().isLength({ max: 200 }).withMessage('Reason max 200 characters')
  ],
  async (req, res, next) => {
    try {
      const { threadId } = req.params;
      const { locked, reason } = req.body;

      const thread = await prisma.forum_threads.update({
        where: { id: parseInt(threadId) },
        data: { is_locked: locked }
      });

      return ResponseWrapper.updated(res, {
        thread: {
          id: thread.id,
          is_locked: thread.is_locked
        },
        action: locked ? 'locked' : 'unlocked',
        reason
      }, `Thread ${locked ? 'locked' : 'unlocked'} successfully`);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;