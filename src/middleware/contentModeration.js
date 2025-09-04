// middleware/contentModeration.js - Forum Content Filtering System
const { PrismaClient } = require('@prisma/client');
const { ForbiddenError } = require('./errorHandler');

const prisma = new PrismaClient();

class ContentModerationService {
  constructor() {
    // Auto-flag these offensive terms (homophobic and racist slurs as specified)
    this.offensiveTerms = [
      // Note: In production, load this from a database for easy management
      'faggot', 'f4ggot', 'fag', 'f4g',
      'nigger', 'n1gger', 'nig', 'n1g',
      'retard', 'ret4rd', 'spic', 'sp1c',
      'kike', 'k1ke', 'chink', 'ch1nk',
      'gook', 'g00k', 'wetback', 'w3tback'
      // Add more as needed, consider regex patterns for variations
    ];

    // Common profanity that gets filtered but not auto-flagged
    this.profanityTerms = [
      'fuck', 'f*ck', 'f**k', 'shit', 'sh*t', 'sh**',
      'damn', 'd*mn', 'hell', 'h*ll', 'ass', 'a**',
      'bitch', 'b*tch', 'bastard', 'b*stard'
    ];

    // Compile regex patterns for better performance
    this.offensiveRegex = new RegExp(
      this.offensiveTerms.map(term => 
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape special chars
      ).join('|'),
      'gi'
    );

    this.profanityRegex = new RegExp(
      this.profanityTerms.map(term => 
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      ).join('|'),
      'gi'
    );
  }

  // Check if content contains auto-flagged terms
  containsOffensiveContent(text) {
    const matches = text.match(this.offensiveRegex);
    return {
      hasOffensive: !!matches,
      matches: matches || [],
      count: matches ? matches.length : 0
    };
  }

  // Filter out profanity by replacing with asterisks
  filterProfanity(text) {
    return text.replace(this.profanityRegex, (match) => {
      return match.charAt(0) + '*'.repeat(match.length - 1);
    });
  }

  // Main content filtering function
  async moderateContent(content, userId, contentType = 'post') {
    const result = {
      originalContent: content,
      filteredContent: content,
      autoFlagged: false,
      flagReason: null,
      requiresReview: false,
      blocked: false
    };

    try {
      // 1. Check for auto-flagged offensive content
      const offensiveCheck = this.containsOffensiveContent(content);
      
      if (offensiveCheck.hasOffensive) {
        result.autoFlagged = true;
        result.requiresReview = true;
        result.flagReason = `Contains offensive language: ${offensiveCheck.matches.join(', ')}`;
        
        // For extremely offensive content, block immediately
        if (offensiveCheck.count > 2) {
          result.blocked = true;
          
          // Log the incident
          await this.logModerationAction(userId, contentType, content, 'AUTO_BLOCKED', result.flagReason);
          
          throw new ForbiddenError('Content contains inappropriate language and has been blocked');
        }

        // Queue for moderation review
        await this.queueForReview(userId, contentType, content, 'offensive_language', result.flagReason);
      }

      // 2. Filter profanity (replace with asterisks)
      result.filteredContent = this.filterProfanity(content);

      // 3. Check content length and spam patterns
      const spamCheck = await this.checkForSpam(content, userId);
      if (spamCheck.isSpam) {
        result.autoFlagged = true;
        result.requiresReview = true;
        result.flagReason = spamCheck.reason;
        
        await this.queueForReview(userId, contentType, content, 'spam', spamCheck.reason);
      }

      // 4. Log successful moderation
      if (result.filteredContent !== result.originalContent) {
        await this.logModerationAction(userId, contentType, content, 'FILTERED', 'Profanity filtered');
      }

      return result;

    } catch (error) {
      console.error('Content moderation error:', error);
      
      if (error instanceof ForbiddenError) {
        throw error; // Re-throw blocked content errors
      }
      
      // For other errors, allow content through but log the error
      await this.logModerationAction(userId, contentType, content, 'ERROR', error.message);
      return result;
    }
  }

  // Simple spam detection
  async checkForSpam(content, userId) {
    // Check for excessive caps
    const capsRatio = (content.match(/[A-Z]/g) || []).length / content.length;
    if (capsRatio > 0.7 && content.length > 50) {
      return {
        isSpam: true,
        reason: 'Excessive use of capital letters'
      };
    }

    // Check for repeated characters
    const repeatedChars = content.match(/(.)\1{4,}/g);
    if (repeatedChars && repeatedChars.length > 2) {
      return {
        isSpam: true,
        reason: 'Excessive repeated characters'
      };
    }

    // Check for duplicate recent posts (last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    try {
      const recentSimilarPosts = await prisma.forum_posts.count({
        where: {
          author_id: userId,
          created_at: { gte: fiveMinutesAgo },
          content: content,
          is_deleted: false
        }
      });

      if (recentSimilarPosts > 0) {
        return {
          isSpam: true,
          reason: 'Duplicate post detected'
        };
      }

      // Check for rapid posting (more than 5 posts in 2 minutes)
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      const rapidPosts = await prisma.forum_posts.count({
        where: {
          author_id: userId,
          created_at: { gte: twoMinutesAgo },
          is_deleted: false
        }
      });

      if (rapidPosts >= 5) {
        return {
          isSpam: true,
          reason: 'Rapid posting detected'
        };
      }

    } catch (error) {
      console.error('Spam check database error:', error);
      // Continue without spam check if DB error
    }

    return { isSpam: false };
  }

  // Queue content for manual review
  async queueForReview(userId, contentType, content, severity, reason) {
    try {
      await prisma.moderation_queue.create({
        data: {
          content_type: contentType,
          content_id: 0, // Will be updated after post is created
          content_text: content,
          user_id: userId,
          severity: severity === 'offensive_language' ? 'high' : 'medium',
          auto_flagged: true,
          status: 'pending',
          created_at: new Date()
        }
      });
    } catch (error) {
      console.error('Failed to queue for review:', error);
    }
  }

  // Log moderation actions
  async logModerationAction(userId, contentType, content, action, reason) {
    try {
      // In a real system, you'd want a dedicated moderation_logs table
      console.log('Moderation Log:', {
        userId,
        contentType,
        contentPreview: content.substring(0, 100),
        action,
        reason,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to log moderation action:', error);
    }
  }

  // Check if user email is verified (required for posting)
  async checkEmailVerification(userId) {
    try {
      const user = await prisma.users.findUnique({
        where: { id: userId },
        select: { email_verified: true }
      });

      return user?.email_verified || false;
    } catch (error) {
      console.error('Email verification check error:', error);
      return false; // Fail safe - assume not verified
    }
  }
}

// Initialize the service
const moderationService = new ContentModerationService();

// Middleware function to filter content
const filterContent = async (req, res, next) => {
  try {
    // Check if user's email is verified
    const isEmailVerified = await moderationService.checkEmailVerification(req.user.id);
    if (!isEmailVerified) {
      throw new ForbiddenError('Email verification required to post content');
    }

    // Skip moderation for admins and moderators
    if (['admin', 'moderator'].includes(req.user.role)) {
      return next();
    }

    const content = req.body.content;
    if (!content || typeof content !== 'string') {
      return next();
    }

    // Moderate the content
    const moderationResult = await moderationService.moderateContent(
      content, 
      req.user.id, 
      req.route.path.includes('thread') ? 'thread' : 'post'
    );

    // Attach results to request for use in route handlers
    req.filteredContent = moderationResult.filteredContent;
    req.autoFlagged = moderationResult.autoFlagged;
    req.moderationResult = moderationResult;

    // If content was blocked, this will throw an error
    if (moderationResult.blocked) {
      throw new ForbiddenError(moderationResult.flagReason);
    }

    next();
  } catch (error) {
    next(error);
  }
};

// Middleware to check if user can post based on recent activity
const rateLimitPosts = async (req, res, next) => {
  try {
    // Skip for mods/admins
    if (['admin', 'moderator'].includes(req.user.role)) {
      return next();
    }

    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    
    const recentPosts = await prisma.forum_posts.count({
      where: {
        author_id: req.user.id,
        created_at: { gte: oneMinuteAgo }
      }
    });

    // Limit to 3 posts per minute for regular users
    if (recentPosts >= 3) {
      throw new ForbiddenError('Posting too quickly. Please wait before posting again.');
    }

    next();
  } catch (error) {
    next(error);
  }
};

// Export middleware functions
module.exports = {
  filterContent,
  rateLimitPosts,
  moderationService
};