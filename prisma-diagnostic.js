// prisma-diagnostic.js
// Run this script to diagnose Prisma connection issues
// Usage: node prisma-diagnostic.js

const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const main = async () => {
  console.log('🔍 Prisma Connection Diagnostic Tool');
  console.log('=====================================');
  
  // Check environment variables
  console.log('\n📋 Environment Check:');
  console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);
  console.log('JWT_SECRET exists:', !!process.env.JWT_SECRET);
  console.log('BCRYPT_ROUNDS:', process.env.BCRYPT_ROUNDS || 'not set (will default to 12)');
  
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set in environment');
    return;
  }
  
  // Initialize Prisma client
  console.log('\n🔌 Initializing Prisma Client...');
  const prisma = new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
  });
  
  try {
    // Test database connection
    console.log('🔗 Testing database connection...');
    await prisma.$connect();
    console.log('✅ Database connection successful');
    
    // Test Prisma client models
    console.log('🔍 Inspecting Prisma client models...');
    console.log('Available models:', Object.keys(prisma));
    console.log('Has user model:', 'user' in prisma);
    console.log('Has User model:', 'User' in prisma);
    
    // Test basic query with proper model name
    console.log('📊 Testing basic query...');
    if ('user' in prisma) {
      const userCount = await prisma.user.count();
      console.log(`✅ User count query successful: ${userCount} users found`);
    } else if ('User' in prisma) {
      const userCount = await prisma.User.count();
      console.log(`✅ User count query successful: ${userCount} users found`);
    } else {
      console.log('❌ No user/User model found in Prisma client');
      return;
    }
    
    // Test schema introspection
    console.log('🔍 Testing schema introspection...');
    const tableInfo = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;
    console.log('✅ Schema introspection successful');
    console.log('📋 Available tables:', tableInfo.map(t => t.table_name).join(', '));
    
    // Test user table structure
    console.log('👤 Testing user table structure...');
    const columnInfo = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'User' 
      ORDER BY ordinal_position;
    `;
    console.log('✅ User table structure:');
    columnInfo.forEach(col => {
      console.log(`   - ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });
    
    // Test finding a user (should not error even if no users exist)
    console.log('🔍 Testing user findFirst...');
    const firstUser = await prisma.user.findFirst({
      select: { id: true, username: true, email: true, idNo: true, createdAt: true }
    });
    console.log('✅ User findFirst successful');
    if (firstUser) {
      console.log('👤 Sample user found:', firstUser);
    } else {
      console.log('👤 No users found (this is normal for a new database)');
    }
    
    // Test ID generation logic
    console.log('🔢 Testing ID generation...');
    const testId = Math.floor(100000 + Math.random() * 900000).toString();
    const existingWithId = await prisma.user.findUnique({
      where: { idNo: testId }
    });
    console.log(`✅ ID check successful: ${testId} is ${existingWithId ? 'taken' : 'available'}`);
    
    console.log('\n🎉 All diagnostic tests passed!');
    console.log('✅ Your Prisma setup is working correctly');
    console.log('\n💡 If you\'re still getting errors, try:');
    console.log('   1. Restart your server: npm run dev');
    console.log('   2. Clear node_modules and reinstall: rm -rf node_modules && npm install');
    console.log('   3. Regenerate Prisma client: npx prisma generate');
    
  } catch (error) {
    console.error('\n❌ Diagnostic failed:');
    console.error('Error:', error.message);
    console.error('Code:', error.code);
    console.error('Meta:', error.meta);
    
    console.log('\n🔧 Troubleshooting suggestions:');
    
    if (error.code === 'P1001') {
      console.log('   - Database server unreachable. Check your DATABASE_URL');
      console.log('   - Verify DigitalOcean database is running');
      console.log('   - Check firewall/network settings');
    } else if (error.code === 'P1003') {
      console.log('   - Database does not exist. Create the database first');
    } else if (error.code === 'P1008') {
      console.log('   - Connection timeout. Check network connectivity');
    } else if (error.code === 'P2021') {
      console.log('   - Table does not exist. Run: npx prisma db push');
    } else if (error.message.includes('findFirst')) {
      console.log('   - Prisma client not properly initialized');
      console.log('   - Run: npx prisma generate');
      console.log('   - Restart your application');
    } else {
      console.log('   - Run: npx prisma db push');
      console.log('   - Run: npx prisma generate');
      console.log('   - Check your DATABASE_URL format');
    }
    
  } finally {
    await prisma.$disconnect();
    console.log('\n🔌 Prisma client disconnected');
  }
};

main().catch((error) => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});