// prisma/seed.js
// Initial data for Galway Research Institute

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Site Configuration
  const siteConfigs = [
    { key: 'site_name', value: 'Galway Research Institute', description: 'Site display name' },
    { key: 'registration_enabled', value: true, description: 'Allow new user registrations' },
    { key: 'trading_enabled', value: true, description: 'Enable trading system' },
    { key: 'forum_enabled', value: true, description: 'Enable forum features' },
    { key: 'seed_price_cents', value: 300, description: 'Price per seed in cents ($3.00)' },
    { key: 'max_inventory_slots', value: 80, description: 'Maximum inventory slots per user' },
    { key: 'escrow_auto_release_days', value: 14, description: 'Days until escrow auto-releases' },
    { key: 'email_verification_required', value: true, description: 'Require email verification' },
    { key: 'daily_rewards_enabled', value: true, description: 'Enable daily login rewards' },
    { key: 'two_factor_required', value: false, description: 'Require 2FA for all users' },
  ];

  for (const config of siteConfigs) {
    await prisma.siteConfig.upsert({
      where: { key: config.key },
      update: { value: config.value },
      create: config,
    });
  }

  // Forum Categories - use createMany or individual creates since no unique name constraint
  const existingCategories = await prisma.forumCategory.findMany();
  if (existingCategories.length === 0) {
    await prisma.forumCategory.createMany({
      data: [
        { name: 'General Discussion', description: 'General community discussions', sortOrder: 1 },
        { name: 'Research & Development', description: 'Technical discussions about our research', sortOrder: 2 },
        { name: 'Trading Post', description: 'Buy, sell, and trade olive branches and seeds', sortOrder: 3 },
        { name: 'Achievements & Leaderboards', description: 'Share your accomplishments', sortOrder: 4 },
        { name: 'Seasonal Events', description: 'Discussion about current and upcoming events', sortOrder: 5 },
        { name: 'Bug Reports', description: 'Report technical issues', sortOrder: 6 },
        { name: 'Feature Requests', description: 'Suggest new features and improvements', sortOrder: 7 },
        { name: 'Announcements', description: 'Official announcements', sortOrder: 8, minRoleToPost: 'moderator' },
      ]
    });
  }

  // Subscription Tiers - use name for upsert since it should be unique
  const subscriptionTiers = [
    {
      name: 'Basic',
      description: 'Essential features for casual collectors',
      priceMonthlycents: 0,
      priceYearlyCents: 0,
      benefits: ['Basic inventory', 'Standard trading', 'Forum access'],
      maxInventorySlots: 80,
      maxTradeOffers: 5,
      earlyAccess: false,
      customThemes: false,
      advancedAnalytics: false,
      prioritySupport: false,
    },
    {
      name: 'Premium',
      description: 'Enhanced features for serious collectors',
      priceMonthlycents: 999,
      priceYearlyCents: 9999,
      benefits: ['Expanded inventory', 'Priority trading', 'Custom themes', 'Advanced analytics'],
      maxInventorySlots: 160,
      maxTradeOffers: 20,
      earlyAccess: false,
      customThemes: true,
      advancedAnalytics: true,
      prioritySupport: false,
    },
    {
      name: 'Elite',
      description: 'Full access for professional traders',
      priceMonthlycents: 1999,
      priceYearlyCents: 19999,
      benefits: ['Maximum inventory', 'Unlimited trading', 'Early access', 'Priority support'],
      maxInventorySlots: 320,
      maxTradeOffers: 50,
      earlyAccess: true,
      customThemes: true,
      advancedAnalytics: true,
      prioritySupport: true,
    },
  ];

  // Create subscription tiers individually to handle potential conflicts
  for (const tier of subscriptionTiers) {
    try {
      await prisma.subscriptionTier.create({
        data: tier,
      });
    } catch (error) {
      if (error.code === 'P2002') {
        console.log(`⚠️  Subscription tier "${tier.name}" already exists, skipping...`);
      } else {
        throw error;
      }
    }
  }

  // Sample Achievements - use name for upsert
  const achievements = [
    {
      name: 'First Steps',
      description: 'Generate your first olive branch',
      badgeIcon: '🌱',
      category: 'collector',
      criteria: { branches_generated: 1 },
      rewardType: 'seeds',
      rewardValue: 1,
    },
    {
      name: 'Green Thumb',
      description: 'Generate 10 olive branches',
      badgeIcon: '🌿',
      category: 'collector',
      criteria: { branches_generated: 10 },
      rewardType: 'seeds',
      rewardValue: 5,
    },
    {
      name: 'Rare Find',
      description: 'Generate a rare olive branch',
      badgeIcon: '💎',
      category: 'collector',
      criteria: { rare_branch_found: true },
      rewardType: 'seeds',
      rewardValue: 3,
    },
    {
      name: 'Social Butterfly',
      description: 'Follow 10 other users',
      badgeIcon: '🦋',
      category: 'social',
      criteria: { follows_made: 10 },
      rewardType: 'seeds',
      rewardValue: 2,
    },
    {
      name: 'Trade Master',
      description: 'Complete 25 successful trades',
      badgeIcon: '🤝',
      category: 'trader',
      criteria: { trades_completed: 25 },
      rewardType: 'seeds',
      rewardValue: 10,
    },
    {
      name: 'Daily Dedication',
      description: 'Login for 30 consecutive days',
      badgeIcon: '📅',
      category: 'collector',
      criteria: { login_streak: 30 },
      rewardType: 'seeds',
      rewardValue: 15,
    },
  ];

  // Create achievements individually
  for (const achievement of achievements) {
    try {
      await prisma.achievement.create({
        data: achievement,
      });
    } catch (error) {
      if (error.code === 'P2002') {
        console.log(`⚠️  Achievement "${achievement.name}" already exists, skipping...`);
      } else {
        throw error;
      }
    }
  }

  // Daily Rewards - create individually since dayNumber may not be unique
  const dailyRewards = [
    { dayNumber: 1, rewardType: 'seeds', rewardAmount: 1 },
    { dayNumber: 2, rewardType: 'seeds', rewardAmount: 1 },
    { dayNumber: 3, rewardType: 'seeds', rewardAmount: 2 },
    { dayNumber: 7, rewardType: 'seeds', rewardAmount: 5, isBonusDay: true, bonusMultiplier: 2.0 },
    { dayNumber: 14, rewardType: 'seeds', rewardAmount: 10, isBonusDay: true, bonusMultiplier: 2.0 },
    { dayNumber: 30, rewardType: 'seeds', rewardAmount: 25, isBonusDay: true, bonusMultiplier: 3.0 },
  ];

  const existingRewards = await prisma.dailyReward.findMany();
  if (existingRewards.length === 0) {
    await prisma.dailyReward.createMany({
      data: dailyRewards,
    });
  }

  // Sample Leaderboards
  const leaderboards = [
    {
      name: 'Top Collectors',
      description: 'Users with the most olive branches',
      category: 'collector',
      scoringMethod: 'total_branches',
      timePeriod: 'all_time',
      isFeatured: true,
    },
    {
      name: 'Weekly Traders',
      description: 'Most active traders this week',
      category: 'trader',
      scoringMethod: 'trades_completed',
      timePeriod: 'weekly',
      isFeatured: true,
    },
    {
      name: 'Monthly Points',
      description: 'Highest point earners this month',
      category: 'collector',
      scoringMethod: 'total_points',
      timePeriod: 'monthly',
      isFeatured: false,
    },
  ];

  // Create leaderboards individually
  for (const leaderboard of leaderboards) {
    try {
      await prisma.leaderboard.create({
        data: leaderboard,
      });
    } catch (error) {
      if (error.code === 'P2002') {
        console.log(`⚠️  Leaderboard "${leaderboard.name}" already exists, skipping...`);
      } else {
        throw error;
      }
    }
  }

  console.log('✅ Database seeded successfully!');
  console.log('📊 Created/Updated:');
  console.log(`   - ${siteConfigs.length} site configuration entries`);
  console.log(`   - 8 forum categories`);
  console.log(`   - ${subscriptionTiers.length} subscription tiers`);
  console.log(`   - ${achievements.length} achievements`);
  console.log(`   - ${dailyRewards.length} daily rewards`);
  console.log(`   - ${leaderboards.length} leaderboards`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });