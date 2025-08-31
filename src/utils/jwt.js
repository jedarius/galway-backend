// utils/jwt.js - JWT Token Utilities
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

class JWTService {
  constructor() {
    this.secret = process.env.JWT_SECRET || crypto.randomBytes(64).toString('hex');
    this.refreshSecret = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(64).toString('hex');
    this.accessTokenExpiry = process.env.JWT_ACCESS_EXPIRY || '15m';
    this.refreshTokenExpiry = process.env.JWT_REFRESH_EXPIRY || '7d';
  }

  generateTokens(user) {
    const payload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      branch: user.branch || null,
      permissions: this.getUserPermissions(user.role),
      activeOliveBranchId: user.activeOliveBranchId || null
    };

    const accessToken = jwt.sign(payload, this.secret, {
      expiresIn: this.accessTokenExpiry,
      issuer: 'galway-research',
      subject: user.id.toString()
    });

    const refreshToken = jwt.sign(
      { userId: user.id, type: 'refresh' },
      this.refreshSecret,
      {
        expiresIn: this.refreshTokenExpiry,
        issuer: 'galway-research',
        subject: user.id.toString()
      }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.getExpirySeconds(this.accessTokenExpiry)
    };
  }

  verifyAccessToken(token) {
    try {
      return jwt.verify(token, this.secret);
    } catch (error) {
      throw new Error(`Invalid access token: ${error.message}`);
    }
  }

  verifyRefreshToken(token) {
    try {
      return jwt.verify(token, this.refreshSecret);
    } catch (error) {
      throw new Error(`Invalid refresh token: ${error.message}`);
    }
  }

  getUserPermissions(role) {
    const permissions = {
      guest: ['read_public'],
      operative: [
        'read_users',
        'update_own_profile',
        'generate_branches',
        'view_inventory',
        'update_inventory',
        'basic_trading'
      ],
      contributor: [
        'read_users',
        'update_own_profile',
        'generate_branches',
        'view_inventory',
        'update_inventory',
        'advanced_trading',
        'create_research_data'
      ],
      beta_tester: [
        'read_users',
        'update_own_profile',
        'generate_branches',
        'view_inventory',
        'update_inventory',
        'advanced_trading',
        'beta_features',
        'submit_feedback'
      ],
      moderator: [
        'read_users',
        'read_all_profiles',
        'update_own_profile',
        'generate_branches',
        'view_inventory',
        'update_inventory',
        'advanced_trading',
        'moderate_content',
        'view_reports'
      ],
      admin: ['*'] // All permissions
    };

    return permissions[role] || permissions.guest;
  }

  getExpirySeconds(expiryString) {
    const unit = expiryString.slice(-1);
    const value = parseInt(expiryString.slice(0, -1));
    
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 60 * 60;
      case 'd': return value * 24 * 60 * 60;
      default: return 900; // 15 minutes default
    }
  }

  extractTokenFromHeader(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7);
  }
}

module.exports = new JWTService();