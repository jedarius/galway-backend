-- Galway Research Institute - Complete Database Schema
-- Optimized for performance, security, and scalability

-- Core user authentication and profiles
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(254) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    role user_role NOT NULL DEFAULT 'operative',
    
    -- Profile data
    bio TEXT CHECK (LENGTH(bio) <= 120),
    onset_date DATE NOT NULL DEFAULT CURRENT_DATE,
    id_no VARCHAR(6) UNIQUE NOT NULL, -- Auto-generated 6-digit ID
    
    -- Optional personal info
    birthday DATE,
    country VARCHAR(100),
    city VARCHAR(100),
    
    -- Verification status
    email_verified BOOLEAN DEFAULT FALSE,
    phone_verified BOOLEAN DEFAULT FALSE,
    email_verification_token VARCHAR(32),
    phone_verification_code VARCHAR(6),
    verification_expires_at TIMESTAMP,
    
    -- Security
    last_username_change TIMESTAMP,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    
    -- Active olive branch reference
    active_olive_branch_id INTEGER,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    
    -- Constraints
    CONSTRAINT valid_username CHECK (username ~ '^[a-z0-9._]+$' AND LENGTH(username) >= 3),
    CONSTRAINT valid_email CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT username_no_consecutive_periods CHECK (username !~ '\.\.')
);

-- User roles enum
CREATE TYPE user_role AS ENUM ('guest', 'operative', 'contributor', 'beta-tester', 'moderator', 'admin');

-- Olive branch botanical signatures (unique generated art)
CREATE TABLE olive_branches (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Generation data (store minimal data, regenerate SVG on demand)
    seed_value VARCHAR(32) NOT NULL, -- For deterministic regeneration
    olive_count INTEGER NOT NULL CHECK (olive_count BETWEEN 1 AND 5),
    olive_type VARCHAR(20) NOT NULL,
    
    -- Color data (hex values)
    olive_color VARCHAR(7) NOT NULL,
    branch_color VARCHAR(7) NOT NULL,
    leaf_color VARCHAR(7) NOT NULL,
    
    -- Rarity metadata
    count_rarity VARCHAR(20) NOT NULL,
    type_rarity VARCHAR(20) NOT NULL,
    count_rarity_percentage INTEGER NOT NULL,
    type_rarity_percentage INTEGER NOT NULL,
    
    -- SVG cache (optional - can regenerate from seed_value)
    svg_cache TEXT,
    
    -- Metadata
    botanical_id VARCHAR(12) UNIQUE NOT NULL, -- Human-readable ID like "OLV-ABC123"
    is_active BOOLEAN DEFAULT FALSE, -- Currently displayed on user profile
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User inventory system (seeds, branches, physical items)
CREATE TABLE inventory_items (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Item classification
    item_type item_type_enum NOT NULL,
    item_id INTEGER, -- References olive_branches.id for branches, NULL for seeds
    
    -- Stackable items (seeds, consumables)
    quantity INTEGER DEFAULT 1 CHECK (quantity > 0),
    
    -- Item source tracking
    source_type VARCHAR(20) NOT NULL, -- 'generated', 'purchased', 'traded', 'earned'
    source_reference VARCHAR(50), -- Order ID, trade ID, etc.
    
    -- Position in inventory grid
    grid_position INTEGER CHECK (grid_position BETWEEN 0 AND 79), -- 80 total slots
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure branches aren't stacked
    CONSTRAINT branch_quantity_one CHECK (
        item_type != 'branch' OR quantity = 1
    ),
    -- Ensure branches have valid references
    CONSTRAINT branch_has_reference CHECK (
        item_type != 'branch' OR item_id IS NOT NULL
    ),
    -- Unique position per user
    UNIQUE(user_id, grid_position)
);

CREATE TYPE item_type_enum AS ENUM ('seed', 'branch', 'physical');

-- Trading system with escrow
CREATE TABLE trades (
    id SERIAL PRIMARY KEY,
    
    -- Parties
    seller_id INTEGER NOT NULL REFERENCES users(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    
    -- Item being traded
    inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
    
    -- Trade terms
    price_cents INTEGER NOT NULL CHECK (price_cents > 0), -- Store in cents to avoid float issues
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Trade status
    status trade_status DEFAULT 'pending',
    
    -- Escrow details
    escrow_payment_id VARCHAR(100), -- Stripe payment intent ID
    escrow_expires_at TIMESTAMP NOT NULL,
    auto_release_at TIMESTAMP, -- Auto-confirm after X days
    
    -- Dispute resolution
    dispute_reason TEXT,
    dispute_evidence JSONB, -- File URLs, messages, etc.
    admin_notes TEXT,
    resolved_by INTEGER REFERENCES users(id),
    
    -- Important timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP,
    completed_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    
    CONSTRAINT no_self_trade CHECK (seller_id != buyer_id)
);

CREATE TYPE trade_status AS ENUM (
    'pending',      -- Waiting for buyer confirmation
    'confirmed',    -- Both parties agreed, payment in escrow
    'shipping',     -- Physical item being shipped (if applicable)
    'disputed',     -- Dispute raised, admin review needed
    'completed',    -- Trade successful, item transferred
    'cancelled',    -- Trade cancelled before completion
    'refunded'      -- Dispute resolved in buyer favor
);

-- Payment system integration
CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    
    -- Payment details
    stripe_payment_intent_id VARCHAR(100) UNIQUE,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Payment purpose
    payment_type payment_type_enum NOT NULL,
    reference_id INTEGER, -- Order ID, trade ID, subscription ID
    
    -- Status tracking
    status payment_status DEFAULT 'pending',
    
    -- Metadata
    stripe_metadata JSONB,
    failure_reason TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    
    -- Ensure reference exists for trades
    CONSTRAINT trade_payment_reference CHECK (
        payment_type != 'trade_escrow' OR reference_id IS NOT NULL
    )
);

CREATE TYPE payment_type_enum AS ENUM ('seed_purchase', 'subscription', 'trade_escrow', 'physical_item');
CREATE TYPE payment_status AS ENUM ('pending', 'succeeded', 'failed', 'cancelled', 'refunded');

-- Forum system
CREATE TABLE forum_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    
    -- Permissions
    min_role_to_view user_role DEFAULT 'operative',
    min_role_to_post user_role DEFAULT 'operative',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE forum_threads (
    id SERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES forum_categories(id),
    
    -- Thread details
    title VARCHAR(200) NOT NULL,
    slug VARCHAR(250) UNIQUE NOT NULL, -- URL-friendly version
    
    -- Author
    author_id INTEGER NOT NULL REFERENCES users(id),
    
    -- Status
    is_pinned BOOLEAN DEFAULT FALSE,
    is_locked BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    
    -- Stats (cached for performance)
    reply_count INTEGER DEFAULT 0,
    last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_reply_by INTEGER REFERENCES users(id),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE forum_posts (
    id SERIAL PRIMARY KEY,
    thread_id INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
    
    -- Post details
    content TEXT NOT NULL CHECK (LENGTH(content) > 0),
    author_id INTEGER NOT NULL REFERENCES users(id),
    
    -- Post metadata
    is_first_post BOOLEAN DEFAULT FALSE, -- Original thread post
    is_deleted BOOLEAN DEFAULT FALSE,
    edited_at TIMESTAMP,
    edited_by INTEGER REFERENCES users(id),
    
    -- Moderation
    is_reported BOOLEAN DEFAULT FALSE,
    report_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Private messaging system
CREATE TABLE private_messages (
    id SERIAL PRIMARY KEY,
    
    -- Participants
    sender_id INTEGER NOT NULL REFERENCES users(id),
    recipient_id INTEGER NOT NULL REFERENCES users(id),
    
    -- Message content
    subject VARCHAR(200),
    content TEXT NOT NULL CHECK (LENGTH(content) > 0),
    
    -- Status
    is_read BOOLEAN DEFAULT FALSE,
    is_deleted_by_sender BOOLEAN DEFAULT FALSE,
    is_deleted_by_recipient BOOLEAN DEFAULT FALSE,
    
    -- Threading
    reply_to_id INTEGER REFERENCES private_messages(id),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP,
    
    CONSTRAINT no_self_message CHECK (sender_id != recipient_id)
);

-- Notification system
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Notification details
    type notification_type NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT,
    
    -- Action/link
    action_url VARCHAR(500),
    
    -- Status
    is_read BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    
    -- Reference data (for trade notifications, etc.)
    reference_type VARCHAR(50), -- 'trade', 'message', 'forum_reply'
    reference_id INTEGER,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMP
);

CREATE TYPE notification_type AS ENUM (
    'trade_offer', 'trade_confirmed', 'trade_completed', 'trade_disputed',
    'payment_received', 'payment_failed',
    'message_received', 'forum_reply', 'forum_mention',
    'account_verification', 'security_alert',
    'admin_announcement'
);

-- User sessions for authentication
CREATE TABLE user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Session data
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    
    -- Device/browser info
    user_agent TEXT,
    ip_address INET,
    
    -- Session metadata
    is_active BOOLEAN DEFAULT TRUE,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Admin activity logs
CREATE TABLE admin_logs (
    id SERIAL PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES users(id),
    
    -- Action details
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50), -- 'user', 'trade', 'post', etc.
    target_id INTEGER,
    
    -- Change details
    old_values JSONB,
    new_values JSONB,
    notes TEXT,
    
    -- Context
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Collection achievements and goals system
CREATE TABLE achievements (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    badge_icon VARCHAR(100), -- Icon/emoji for the badge
    category achievement_category NOT NULL,
    
    -- Achievement criteria (JSON for flexibility)
    criteria JSONB NOT NULL, -- e.g., {"olive_count": 10, "rarity": "rare"}
    reward_type reward_type_enum,
    reward_value INTEGER, -- Seeds, points, etc.
    
    -- Visibility and ordering
    is_active BOOLEAN DEFAULT TRUE,
    is_hidden BOOLEAN DEFAULT FALSE, -- Secret achievements
    sort_order INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE achievement_category AS ENUM ('collector', 'trader', 'social', 'seasonal', 'special');
CREATE TYPE reward_type_enum AS ENUM ('seeds', 'points', 'badge_only', 'early_access');

-- User achievement progress tracking
CREATE TABLE user_achievements (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id INTEGER NOT NULL REFERENCES achievements(id),
    
    -- Progress tracking
    progress_current INTEGER DEFAULT 0,
    progress_required INTEGER NOT NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    
    -- Completion data
    completed_at TIMESTAMP,
    claimed_at TIMESTAMP,
    
    -- Progress metadata (for complex achievements)
    progress_data JSONB,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, achievement_id)
);

-- User following/friends system
CREATE TABLE user_follows (
    id SERIAL PRIMARY KEY,
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Follow metadata
    is_mutual BOOLEAN DEFAULT FALSE, -- Auto-calculated
    notification_enabled BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT no_self_follow CHECK (follower_id != following_id),
    UNIQUE(follower_id, following_id)
);

-- Activity feed system
CREATE TABLE activity_feed (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Activity details
    activity_type activity_type_enum NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    
    -- Referenced objects
    reference_type VARCHAR(50), -- 'olive_branch', 'trade', 'achievement'
    reference_id INTEGER,
    reference_data JSONB, -- Store snapshot of referenced object
    
    -- Visibility and engagement
    is_public BOOLEAN DEFAULT TRUE,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE activity_type_enum AS ENUM (
    'branch_generated', 'rare_branch_found', 'trade_completed',
    'achievement_unlocked', 'milestone_reached', 'level_up',
    'collection_goal_completed', 'seasonal_event_participated',
    'referred_friend', 'forum_post_featured'
);

-- Activity feed likes and comments
CREATE TABLE activity_likes (
    id SERIAL PRIMARY KEY,
    activity_id INTEGER NOT NULL REFERENCES activity_feed(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(activity_id, user_id)
);

CREATE TABLE activity_comments (
    id SERIAL PRIMARY KEY,
    activity_id INTEGER NOT NULL REFERENCES activity_feed(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (LENGTH(content) > 0),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User reviews and ratings system
CREATE TABLE user_reviews (
    id SERIAL PRIMARY KEY,
    reviewer_id INTEGER NOT NULL REFERENCES users(id),
    reviewed_id INTEGER NOT NULL REFERENCES users(id),
    
    -- Review details
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title VARCHAR(100),
    comment TEXT,
    
    -- Context (what transaction prompted this review)
    trade_id INTEGER REFERENCES trades(id),
    transaction_type VARCHAR(50), -- 'trade', 'forum_interaction', etc.
    
    -- Status
    is_public BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE, -- Verified transaction
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT no_self_review CHECK (reviewer_id != reviewed_id),
    UNIQUE(reviewer_id, reviewed_id, trade_id)
);

-- Daily login rewards system
CREATE TABLE daily_rewards (
    id SERIAL PRIMARY KEY,
    day_number INTEGER NOT NULL, -- Day 1, 2, 3, etc.
    reward_type reward_type_enum NOT NULL,
    reward_amount INTEGER NOT NULL,
    
    -- Special rewards
    is_bonus_day BOOLEAN DEFAULT FALSE, -- Weekend/special multipliers
    bonus_multiplier DECIMAL(3,2) DEFAULT 1.0,
    
    -- Streak requirements
    requires_consecutive BOOLEAN DEFAULT TRUE,
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User daily login tracking
CREATE TABLE user_daily_logins (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Streak tracking
    login_date DATE NOT NULL,
    current_streak INTEGER DEFAULT 1,
    longest_streak INTEGER DEFAULT 1,
    
    -- Reward tracking
    reward_claimed BOOLEAN DEFAULT FALSE,
    reward_type reward_type_enum,
    reward_amount INTEGER,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, login_date)
);

-- Leaderboards system
CREATE TABLE leaderboards (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    category leaderboard_category NOT NULL,
    
    -- Leaderboard configuration
    scoring_method VARCHAR(50) NOT NULL, -- 'collection_value', 'trade_volume', etc.
    time_period leaderboard_period NOT NULL,
    max_entries INTEGER DEFAULT 100,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE leaderboard_category AS ENUM ('collector', 'trader', 'social', 'forum', 'seasonal');
CREATE TYPE leaderboard_period AS ENUM ('daily', 'weekly', 'monthly', 'all_time', 'seasonal');

-- Leaderboard entries (current standings)
CREATE TABLE leaderboard_entries (
    id SERIAL PRIMARY KEY,
    leaderboard_id INTEGER NOT NULL REFERENCES leaderboards(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Ranking data
    rank_position INTEGER NOT NULL,
    score DECIMAL(12,2) NOT NULL,
    score_data JSONB, -- Breakdown of how score was calculated
    
    -- Metadata
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(leaderboard_id, user_id, period_start)
);

-- Seasonal events system
CREATE TABLE seasonal_events (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    
    -- Event timing
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    timezone VARCHAR(50) DEFAULT 'UTC',
    
    -- Event configuration
    event_type seasonal_event_type NOT NULL,
    special_mechanics JSONB, -- Event-specific rules
    
    -- Rewards and goals
    participation_reward_type reward_type_enum,
    participation_reward_amount INTEGER,
    completion_rewards JSONB, -- Tiered rewards
    
    -- Visual customization
    theme_colors JSONB,
    banner_image VARCHAR(200),
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_featured BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE seasonal_event_type AS ENUM ('breeding_bonus', 'rare_boost', 'trading_festival', 'community_challenge');

-- User participation in seasonal events
CREATE TABLE user_event_participation (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES seasonal_events(id),
    
    -- Participation data
    progress_current INTEGER DEFAULT 0,
    progress_target INTEGER NOT NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    
    -- Rewards tracking
    rewards_claimed JSONB DEFAULT '[]',
    total_rewards_value INTEGER DEFAULT 0,
    
    -- Participation metadata
    participation_data JSONB,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    
    UNIQUE(user_id, event_id)
);

-- Referral program system
CREATE TABLE referral_codes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Code details
    code VARCHAR(20) UNIQUE NOT NULL,
    max_uses INTEGER DEFAULT NULL, -- NULL = unlimited
    current_uses INTEGER DEFAULT 0,
    
    -- Rewards
    referrer_reward_type reward_type_enum NOT NULL,
    referrer_reward_amount INTEGER NOT NULL,
    referee_reward_type reward_type_enum NOT NULL,
    referee_reward_amount INTEGER NOT NULL,
    
    -- Status and timing
    is_active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Referral tracking
CREATE TABLE referrals (
    id SERIAL PRIMARY KEY,
    referrer_id INTEGER NOT NULL REFERENCES users(id),
    referee_id INTEGER NOT NULL REFERENCES users(id),
    referral_code_id INTEGER NOT NULL REFERENCES referral_codes(id),
    
    -- Conversion tracking
    signup_completed BOOLEAN DEFAULT FALSE,
    first_purchase_completed BOOLEAN DEFAULT FALSE,
    
    -- Reward tracking
    referrer_rewarded BOOLEAN DEFAULT FALSE,
    referee_rewarded BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    converted_at TIMESTAMP,
    
    CONSTRAINT no_self_referral CHECK (referrer_id != referee_id)
);

-- Two-factor authentication system
CREATE TABLE user_2fa (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- 2FA methods
    totp_secret VARCHAR(32), -- Time-based OTP secret
    sms_enabled BOOLEAN DEFAULT FALSE,
    app_enabled BOOLEAN DEFAULT FALSE,
    
    -- Backup codes
    backup_codes JSONB, -- Array of hashed backup codes
    backup_codes_used INTEGER DEFAULT 0,
    
    -- Recovery
    recovery_codes JSONB, -- Long-term recovery codes
    
    -- Status
    is_enabled BOOLEAN DEFAULT FALSE,
    last_used TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id)
);

-- Account recovery system
CREATE TABLE account_recovery (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Recovery method
    recovery_type recovery_method_type NOT NULL,
    recovery_token VARCHAR(255) NOT NULL,
    
    -- Recovery data
    recovery_data JSONB, -- Questions/answers, contact info, etc.
    
    -- Status and timing
    is_used BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    
    -- Security
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE recovery_method_type AS ENUM ('email', 'sms', 'security_questions', 'admin_review');

-- IP blocking and rate limiting
CREATE TABLE ip_blocks (
    id SERIAL PRIMARY KEY,
    ip_address INET NOT NULL,
    
    -- Block details
    block_type block_type_enum NOT NULL,
    reason TEXT NOT NULL,
    
    -- Timing
    blocked_until TIMESTAMP, -- NULL = permanent
    
    -- Metadata
    blocked_by INTEGER REFERENCES users(id),
    auto_generated BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE block_type_enum AS ENUM ('temporary', 'permanent', 'rate_limit', 'suspicious_activity');

-- Rate limiting tracking
CREATE TABLE rate_limits (
    id SERIAL PRIMARY KEY,
    identifier VARCHAR(100) NOT NULL, -- IP address or user ID
    identifier_type VARCHAR(20) NOT NULL, -- 'ip' or 'user'
    
    -- Rate limit details
    action VARCHAR(50) NOT NULL, -- 'login', 'api_call', 'trade_request'
    attempts INTEGER DEFAULT 1,
    window_start TIMESTAMP NOT NULL,
    window_duration INTERVAL NOT NULL,
    
    -- Status
    is_blocked BOOLEAN DEFAULT FALSE,
    blocked_until TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(identifier, identifier_type, action, window_start)
);

-- Content moderation system
CREATE TABLE moderation_rules (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    
    -- Rule configuration
    rule_type moderation_rule_type NOT NULL,
    severity moderation_severity NOT NULL,
    auto_action moderation_action,
    
    -- Rule criteria (regex, keywords, ML model, etc.)
    criteria JSONB NOT NULL,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(id)
);

CREATE TYPE moderation_rule_type AS ENUM ('keyword_filter', 'regex_pattern', 'ml_classifier', 'user_report_threshold');
CREATE TYPE moderation_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE moderation_action AS ENUM ('flag', 'hide', 'delete', 'warn_user', 'suspend_user', 'ban_user');

-- Content moderation queue
CREATE TABLE moderation_queue (
    id SERIAL PRIMARY KEY,
    
    -- Content details
    content_type VARCHAR(50) NOT NULL, -- 'forum_post', 'message', 'user_bio', etc.
    content_id INTEGER NOT NULL,
    content_text TEXT,
    
    -- User and context
    user_id INTEGER NOT NULL REFERENCES users(id),
    
    -- Moderation details
    triggered_rule_id INTEGER REFERENCES moderation_rules(id),
    severity moderation_severity NOT NULL,
    auto_flagged BOOLEAN DEFAULT FALSE,
    
    -- Status
    status moderation_status DEFAULT 'pending',
    reviewed_by INTEGER REFERENCES users(id),
    review_notes TEXT,
    action_taken moderation_action,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP
);

CREATE TYPE moderation_status AS ENUM ('pending', 'approved', 'rejected', 'escalated');

-- Analytics tracking system
CREATE TABLE analytics_events (
    id SERIAL PRIMARY KEY,
    
    -- Event details
    event_type VARCHAR(100) NOT NULL,
    event_category VARCHAR(50) NOT NULL,
    event_data JSONB,
    
    -- User context
    user_id INTEGER REFERENCES users(id),
    session_id VARCHAR(100),
    
    -- Technical context
    ip_address INET,
    user_agent TEXT,
    referrer TEXT,
    
    -- Timing
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subscription tiers system
CREATE TABLE subscription_tiers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    
    -- Pricing
    price_monthly_cents INTEGER NOT NULL,
    price_yearly_cents INTEGER, -- Annual discount
    
    -- Benefits (JSON for flexibility)
    benefits JSONB NOT NULL,
    
    -- Limits and features
    max_inventory_slots INTEGER DEFAULT 80,
    max_trade_offers INTEGER DEFAULT 10,
    api_rate_limit INTEGER DEFAULT 1000, -- Requests per hour
    
    -- Feature flags
    early_access BOOLEAN DEFAULT FALSE,
    custom_themes BOOLEAN DEFAULT FALSE,
    advanced_analytics BOOLEAN DEFAULT FALSE,
    priority_support BOOLEAN DEFAULT FALSE,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User subscriptions
CREATE TABLE user_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier_id INTEGER NOT NULL REFERENCES subscription_tiers(id),
    
    -- Subscription details
    stripe_subscription_id VARCHAR(100) UNIQUE,
    status subscription_status NOT NULL,
    
    -- Billing cycle
    billing_cycle subscription_cycle NOT NULL,
    current_period_start TIMESTAMP NOT NULL,
    current_period_end TIMESTAMP NOT NULL,
    
    -- Payment tracking
    last_payment_date TIMESTAMP,
    next_payment_date TIMESTAMP,
    
    -- Status changes
    cancelled_at TIMESTAMP,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'cancelled', 'unpaid', 'incomplete');
CREATE TYPE subscription_cycle AS ENUM ('monthly', 'yearly');

-- Custom themes system
CREATE TABLE user_themes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Theme details
    name VARCHAR(50) NOT NULL,
    theme_data JSONB NOT NULL, -- Colors, fonts, layout preferences
    
    -- Status
    is_active BOOLEAN DEFAULT FALSE,
    is_public BOOLEAN DEFAULT FALSE, -- Can other users use this theme?
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Early access features tracking
CREATE TABLE early_access_features (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    
    -- Access control
    min_tier_required INTEGER REFERENCES subscription_tiers(id),
    invited_users_only BOOLEAN DEFAULT FALSE,
    
    -- Feature status
    is_active BOOLEAN DEFAULT TRUE,
    rollout_percentage INTEGER DEFAULT 0, -- Gradual rollout
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    launched_at TIMESTAMP -- When feature became generally available
);

-- User early access permissions
CREATE TABLE user_early_access (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature_id INTEGER NOT NULL REFERENCES early_access_features(id),
    
    -- Access details
    granted_by INTEGER REFERENCES users(id), -- Admin who granted access
    access_reason TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, feature_id)
);

-- Advanced analytics data warehouse tables
CREATE TABLE analytics_user_metrics (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Time period
    metric_date DATE NOT NULL,
    metric_type VARCHAR(50) NOT NULL, -- 'daily', 'weekly', 'monthly'
    
    -- Engagement metrics
    session_count INTEGER DEFAULT 0,
    session_duration_minutes INTEGER DEFAULT 0,
    page_views INTEGER DEFAULT 0,
    
    -- Trading metrics
    trades_initiated INTEGER DEFAULT 0,
    trades_completed INTEGER DEFAULT 0,
    trade_volume_cents INTEGER DEFAULT 0,
    
    -- Collection metrics
    branches_generated INTEGER DEFAULT 0,
    seeds_planted INTEGER DEFAULT 0,
    achievements_unlocked INTEGER DEFAULT 0,
    
    -- Social metrics
    forum_posts INTEGER DEFAULT 0,
    messages_sent INTEGER DEFAULT 0,
    follows_gained INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id, metric_date, metric_type)
);

-- Global platform metrics
CREATE TABLE platform_metrics (
    id SERIAL PRIMARY KEY,
    
    -- Time period
    metric_date DATE NOT NULL,
    metric_type VARCHAR(50) NOT NULL,
    
    -- User metrics
    total_users INTEGER DEFAULT 0,
    active_users INTEGER DEFAULT 0,
    new_signups INTEGER DEFAULT 0,
    
    -- Trading metrics
    total_trades INTEGER DEFAULT 0,
    trade_volume_cents INTEGER DEFAULT 0,
    
    -- Revenue metrics
    subscription_revenue_cents INTEGER DEFAULT 0,
    marketplace_fees_cents INTEGER DEFAULT 0,
    
    -- Content metrics
    forum_posts INTEGER DEFAULT 0,
    olive_branches_generated INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(metric_date, metric_type)
);

-- Site configuration (settings, feature flags, etc.)
CREATE TABLE site_config (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_by INTEGER REFERENCES users(id),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance (updated with new tables)
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_created_at ON users(created_at);

CREATE INDEX idx_olive_branches_user_id ON olive_branches(user_id);
CREATE INDEX idx_olive_branches_botanical_id ON olive_branches(botanical_id);
CREATE INDEX idx_olive_branches_rarity ON olive_branches(count_rarity, type_rarity);

CREATE INDEX idx_inventory_user_id ON inventory_items(user_id);
CREATE INDEX idx_inventory_type ON inventory_items(item_type);
CREATE INDEX idx_inventory_position ON inventory_items(user_id, grid_position);

CREATE INDEX idx_trades_seller ON trades(seller_id);
CREATE INDEX idx_trades_buyer ON trades(buyer_id);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_created_at ON trades(created_at);

CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_stripe_id ON payments(stripe_payment_intent_id);
CREATE INDEX idx_payments_status ON payments(status);

CREATE INDEX idx_forum_posts_thread_id ON forum_posts(thread_id);
CREATE INDEX idx_forum_posts_author ON forum_posts(author_id);
CREATE INDEX idx_forum_threads_category ON forum_threads(category_id);
CREATE INDEX idx_forum_threads_activity ON forum_threads(last_activity_at);

CREATE INDEX idx_messages_participants ON private_messages(sender_id, recipient_id);
CREATE INDEX idx_messages_recipient_unread ON private_messages(recipient_id, is_read);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

CREATE INDEX idx_sessions_token ON user_sessions(token_hash);
CREATE INDEX idx_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);

-- New feature indexes
CREATE INDEX idx_user_achievements_user_id ON user_achievements(user_id);
CREATE INDEX idx_user_achievements_completed ON user_achievements(user_id, is_completed);
CREATE INDEX idx_user_follows_follower ON user_follows(follower_id);
CREATE INDEX idx_user_follows_following ON user_follows(following_id);
CREATE INDEX idx_activity_feed_user_id ON activity_feed(user_id);
CREATE INDEX idx_activity_feed_public ON activity_feed(is_public, created_at);
CREATE INDEX idx_activity_feed_type ON activity_feed(activity_type, created_at);
CREATE INDEX idx_user_reviews_reviewed ON user_reviews(reviewed_id);
CREATE INDEX idx_user_reviews_rating ON user_reviews(rating, is_public);
CREATE INDEX idx_daily_logins_user_date ON user_daily_logins(user_id, login_date);
CREATE INDEX idx_leaderboard_entries_rank ON leaderboard_entries(leaderboard_id, rank_position);
CREATE INDEX idx_seasonal_events_active ON seasonal_events(is_active, start_date, end_date);
CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX idx_rate_limits_identifier ON rate_limits(identifier, identifier_type, action);
CREATE INDEX idx_moderation_queue_status ON moderation_queue(status, created_at);
CREATE INDEX idx_analytics_events_type ON analytics_events(event_type, created_at);
CREATE INDEX idx_analytics_events_user ON analytics_events(user_id, created_at);
CREATE INDEX idx_user_subscriptions_status ON user_subscriptions(user_id, status);
CREATE INDEX idx_user_metrics_date ON analytics_user_metrics(user_id, metric_date);
CREATE INDEX idx_platform_metrics_date ON platform_metrics(metric_date, metric_type);

-- Foreign key constraint for active olive branch
ALTER TABLE users ADD CONSTRAINT fk_users_active_branch 
    FOREIGN KEY (active_olive_branch_id) REFERENCES olive_branches(id);

-- Sample data for development (updated with new features)
INSERT INTO site_config (key, value, description) VALUES
('site_name', '"Galway Research Institute"', 'Site display name'),
('registration_enabled', 'true', 'Allow new user registrations'),
('trading_enabled', 'true', 'Enable trading system'),
('forum_enabled', 'true', 'Enable forum features'),
('seed_price_cents', '300', 'Price per seed in cents ($3.00)'),
('max_inventory_slots', '80', 'Maximum inventory slots per user'),
('escrow_auto_release_days', '14', 'Days until escrow auto-releases'),
('email_verification_required', 'true', 'Require email verification for new accounts'),
('daily_rewards_enabled', 'true', 'Enable daily login rewards system'),
('seasonal_events_enabled', 'true', 'Enable seasonal events'),
('leaderboards_enabled', 'true', 'Enable leaderboard system'),
('referral_program_enabled', 'true', 'Enable referral program'),
('two_factor_required', 'false', 'Require 2FA for all users'),
('content_moderation_enabled', 'true', 'Enable automated content moderation'),
('analytics_tracking_enabled', 'true', 'Enable user analytics tracking'),
('subscription_tiers_enabled', 'true', 'Enable subscription system'),
('early_access_enabled', 'true', 'Enable early access features'),
('custom_themes_enabled', 'true', 'Enable custom user themes');

-- Initial forum categories
INSERT INTO forum_categories (name, description, sort_order) VALUES
('General Discussion', 'General community discussions', 1),
('Research & Development', 'Technical discussions about our research', 2),
('Trading Post', 'Buy, sell, and trade olive branches and seeds', 3),
('Achievements & Leaderboards', 'Share your accomplishments and compete', 4),
('Seasonal Events', 'Discussion about current and upcoming events', 5),
('Bug Reports', 'Report technical issues', 6),
('Feature Requests', 'Suggest new features and improvements', 7),
('Announcements', 'Official announcements from the Institute', 8);

-- Sample achievements
INSERT INTO achievements (name, description, badge_icon, category, criteria, reward_type, reward_value) VALUES
('First Steps', 'Generate your first olive branch', '🌱', 'collector', '{"branches_generated": 1}', 'seeds', 1),
('Green Thumb', 'Generate 10 olive branches', '🌿', 'collector', '{"branches_generated": 10}', 'seeds', 5),
('Rare Find', 'Generate a rare olive branch', '💎', 'collector', '{"rare_branch_found": true}', 'seeds', 3),
('Social Butterfly', 'Follow 10 other users', '🦋', 'social', '{"follows_made": 10}', 'seeds', 2),
('Trade Master', 'Complete 25 successful trades', '🤝', 'trader', '{"trades_completed": 25}', 'seeds', 10),
('Daily Dedication', 'Login for 30 consecutive days', '📅', 'collector', '{"login_streak": 30}', 'seeds', 15),
('Forum Regular', 'Make 100 forum posts', '💬', 'social', '{"forum_posts": 100}', 'badge_only', 0),
('Collector Supreme', 'Own 50 olive branches', '👑', 'collector', '{"total_branches": 50}', 'early_access', 0);

-- Sample subscription tiers
INSERT INTO subscription_tiers (name, description, price_monthly_cents, price_yearly_cents, benefits, max_inventory_slots, max_trade_offers, early_access, custom_themes, advanced_analytics, priority_support) VALUES
('Basic', 'Essential features for casual collectors', 0, 0, '["Basic inventory", "Standard trading", "Forum access"]', 80, 5, false, false, false, false),
('Premium', 'Enhanced features for serious collectors', 999, 9999, '["Expanded inventory", "Priority trading", "Custom themes", "Advanced analytics"]', 160, 20, false, true, true, false),
('Elite', 'Full access for professional traders', 1999, 19999, '["Maximum inventory", "Unlimited trading", "Early access", "Priority support", "Exclusive events"]', 320, 50, true, true, true, true);

-- Sample daily rewards
INSERT INTO daily_rewards (day_number, reward_type, reward_amount, is_bonus_day, bonus_multiplier) VALUES
(1, 'seeds', 1, false, 1.0),
(2, 'seeds', 1, false, 1.0),
(3, 'seeds', 2, false, 1.0),
(4, 'seeds', 2, false, 1.0),
(5, 'seeds', 3, false, 1.0),
(6, 'seeds', 3, false, 1.0),
(7, 'seeds', 5, true, 2.0), -- Bonus Sunday
(8, 'seeds', 2, false, 1.0),
(9, 'seeds', 2, false, 1.0),
(10, 'seeds', 3, false, 1.0),
(14, 'seeds', 10, true, 2.0), -- Two week bonus
(21, 'seeds', 15, true, 2.0), -- Three week bonus
(30, 'seeds', 25, true, 3.0); -- Monthly bonus

-- Sample leaderboards
INSERT INTO leaderboards (name, description, category, scoring_method, time_period, is_featured) VALUES
('Top Collectors', 'Users with the most olive branches', 'collector', 'total_branches', 'all_time', true),
('Weekly Traders', 'Most active traders this week', 'trader', 'trades_completed', 'weekly', true),
('Monthly Points', 'Highest point earners this month', 'collector', 'total_points', 'monthly', false),
('Seasonal Champions', 'Current seasonal event leaders', 'seasonal', 'event_points', 'seasonal', true),
('Forum Contributors', 'Most helpful forum members', 'forum', 'helpful_posts', 'monthly', false);

-- Sample moderation rules
INSERT INTO moderation_rules (name, description, rule_type, severity, auto_action, criteria) VALUES
('Spam Filter', 'Detect spam and promotional content', 'keyword_filter', 'medium', 'flag', '{"keywords": ["buy now", "click here", "limited time", "free money"]}'),
('Profanity Filter', 'Filter inappropriate language', 'keyword_filter', 'high', 'hide', '{"keywords": ["censored", "words", "list"]}'),
('Scam Detection', 'Detect potential scam attempts', 'ml_classifier', 'critical', 'delete', '{"model": "scam_detection_v1", "threshold": 0.8}'),
('Report Threshold', 'Auto-hide content with multiple reports', 'user_report_threshold', 'high', 'hide', '{"report_count": 3, "time_window": "24h"}');

-- Sample early access features
INSERT INTO early_access_features (name, description, min_tier_required, rollout_percentage) VALUES
('Advanced Trading Dashboard', 'Enhanced trading interface with analytics', 2, 50),
('AI Branch Recommendations', 'Machine learning powered collection suggestions', 3, 25),
('Custom Rarity Filters', 'Advanced filtering options for rare items', 2, 75),
('Social Trading Groups', 'Create and join trading communities', 2, 10);