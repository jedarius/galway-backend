// test-db-connection.js
// Run this to verify your Digital Ocean database connection

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  log: ['info', 'warn', 'error'],
});

async function testConnection() {
  try {
    console.log('🔄 Testing database connection...');
    console.log('📍 Connecting to Digital Ocean PostgreSQL...');
    
    // Test basic connection
    await prisma.$connect();
    console.log('✅ Successfully connected to Digital Ocean PostgreSQL');
    
    // Test a simple query
    const result = await prisma.$queryRaw`SELECT version()`;
    console.log('📊 Database version:', result[0].version);
    
    // Check current database name
    const dbInfo = await prisma.$queryRaw`SELECT current_database()`;
    console.log('🗄️  Connected to database:', dbInfo[0].current_database);
    
    // Check if we can introspect the database
    const tables = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `;
    
    if (tables.length === 0) {
      console.log('⚠️  No tables found - ready for initial migration');
    } else {
      console.log('📋 Existing tables:', tables.map(t => t.table_name).join(', '));
    }
    
    console.log('✅ Database connection test completed successfully!');
    console.log('🚀 Ready to run: npx prisma db push');
    
  } catch (error) {
    console.error('❌ Database connection failed:');
    console.error('Error:', error.message);
    
    if (error.message.includes('ENOTFOUND')) {
      console.error('💡 Check your host URL and internet connection');
    } else if (error.message.includes('authentication')) {
      console.error('💡 Check your username and password in .env file');
    } else if (error.message.includes('SSL') || error.message.includes('ssl')) {
      console.error('💡 SSL connection issue - ensure sslmode=require in connection string');
    } else if (error.message.includes('timeout')) {
      console.error('💡 Connection timeout - check firewall/trusted sources in Digital Ocean');
    }
    
    console.error('\n🔧 Your DATABASE_URL should look like:');
    console.error('DATABASE_URL="postgresql://doadmin:PASSWORD@HOST:25060/defaultdb?sslmode=require"');
    
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testConnection();