// prisma/seed-ecommerce.js
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding e-commerce data...');

  // Create store categories
  const physicalCategory = await prisma.store_categories.upsert({
    where: { slug: 'merchandise' },
    update: {},
    create: {
      name: 'Merchandise',
      slug: 'merchandise',
      description: 'Physical merchandise and branded items',
      item_type: 'physical',
      display_order: 1,
      is_active: true
    }
  });

  const digitalCategory = await prisma.store_categories.upsert({
    where: { slug: 'digital-content' },
    update: {},
    create: {
      name: 'Digital Content',
      slug: 'digital-content',
      description: 'Digital downloads and virtual items',
      item_type: 'digital',
      display_order: 2,
      is_active: true
    }
  });

  const accessoriesCategory = await prisma.store_categories.upsert({
    where: { slug: 'accessories' },
    update: {},
    create: {
      name: 'Accessories',
      slug: 'accessories',
      description: 'Small accessories and add-ons',
      item_type: 'physical',
      display_order: 3,
      is_active: true,
      parent_id: physicalCategory.id
    }
  });

  console.log('✅ Categories created');

  // Create sample physical products
  const tshirt = await prisma.store_items.upsert({
    where: { slug: 'galway-institute-t-shirt' },
    update: {},
    create: {
      name: 'Galway Institute T-Shirt',
      slug: 'galway-institute-t-shirt',
      description: 'High-quality cotton t-shirt with the Galway Research Institute logo. Perfect for showing your support!',
      short_description: 'Official GRI cotton t-shirt with logo',
      category_id: physicalCategory.id,
      item_type: 'physical',
      price_cents: 2999, // $29.99 CAD
      compare_at_price_cents: 3999, // Show as on sale from $39.99
      weight_grams: 200,
      requires_shipping: true,
      manage_inventory: true,
      stock_quantity: 100,
      low_stock_threshold: 10,
      allow_backorder: false,
      meta_title: 'Official Galway Institute T-Shirt - Premium Cotton',
      meta_description: 'Show your support with our official GRI t-shirt. Made from premium cotton.',
      images: [
        'https://example.com/images/tshirt-front.jpg',
        'https://example.com/images/tshirt-back.jpg'
      ],
      featured_image: 'https://example.com/images/tshirt-front.jpg',
      is_active: true,
      is_featured: true,
      published_at: new Date()
    }
  });

  // Create variants for t-shirt (sizes and colors)
  const tshirtVariants = [
    { name: 'Small Black', options: { size: 'S', color: 'Black' }, stock_quantity: 25 },
    { name: 'Medium Black', options: { size: 'M', color: 'Black' }, stock_quantity: 30 },
    { name: 'Large Black', options: { size: 'L', color: 'Black' }, stock_quantity: 25 },
    { name: 'XL Black', options: { size: 'XL', color: 'Black' }, stock_quantity: 15 },
    { name: 'Small Navy', options: { size: 'S', color: 'Navy' }, stock_quantity: 20 },
    { name: 'Medium Navy', options: { size: 'M', color: 'Navy' }, stock_quantity: 25 },
    { name: 'Large Navy', options: { size: 'L', color: 'Navy' }, stock_quantity: 20 },
    { name: 'XL Navy', options: { size: 'XL', color: 'Navy' }, stock_quantity: 10 }
  ];

  for (const variant of tshirtVariants) {
    await prisma.store_item_variants.upsert({
      where: {
        item_id_name: {
          item_id: tshirt.id,
          name: variant.name
        }
      },
      update: {},
      create: {
        item_id: tshirt.id,
        name: variant.name,
        sku: `TSHIRT-${variant.options.size}-${variant.options.color.toUpperCase()}`,
        options: variant.options,
        stock_quantity: variant.stock_quantity,
        weight_grams: 200,
        is_active: true
      }
    });
  }

  // Create sample stickers
  const stickers = await prisma.store_items.upsert({
    where: { slug: 'galway-institute-sticker-pack' },
    update: {},
    create: {
      name: 'Galway Institute Sticker Pack',
      slug: 'galway-institute-sticker-pack',
      description: 'A pack of 5 high-quality vinyl stickers featuring various Galway Research Institute designs. Weather-resistant and perfect for laptops, water bottles, and more!',
      short_description: 'Pack of 5 weather-resistant vinyl stickers',
      category_id: accessoriesCategory.id,
      item_type: 'physical',
      price_cents: 899, // $8.99 CAD
      weight_grams: 50,
      requires_shipping: true,
      manage_inventory: true,
      stock_quantity: 500,
      low_stock_threshold: 50,
      allow_backorder: true,
      featured_image: 'https://example.com/images/sticker-pack.jpg',
      is_active: true,
      published_at: new Date()
    }
  });

  // Create sample digital products
  const digitalGuide = await prisma.store_items.upsert({
    where: { slug: 'olive-branch-cultivation-guide' },
    update: {},
    create: {
      name: 'Olive Branch Cultivation Guide',
      slug: 'olive-branch-cultivation-guide',
      description: 'A comprehensive digital guide covering everything you need to know about cultivating and caring for olive branches. Includes exclusive tips from our research team and detailed illustrations.',
      short_description: 'Complete digital guide to olive branch cultivation',
      category_id: digitalCategory.id,
      item_type: 'digital',
      price_cents: 1999, // $19.99 CAD
      requires_shipping: false,
      download_url: '/downloads/olive-guide.pdf',
      download_limit: 5,
      access_duration_days: 365, // Access for 1 year
      manage_inventory: false,
      featured_image: 'https://example.com/images/olive-guide-cover.jpg',
      is_active: true,
      is_featured: true,
      published_at: new Date()
    }
  });

  const researchPaper = await prisma.store_items.upsert({
    where: { slug: 'advanced-botanical-research-collection' },
    update: {},
    create: {
      name: 'Advanced Botanical Research Collection',
      slug: 'advanced-botanical-research-collection',
      description: 'Access to our exclusive collection of advanced botanical research papers. Includes 50+ research documents, case studies, and experimental data from the Galway Research Institute.',
      short_description: 'Exclusive collection of 50+ research papers',
      category_id: digitalCategory.id,
      item_type: 'digital',
      price_cents: 4999, // $49.99 CAD
      requires_shipping: false,
      download_limit: 10,
      access_duration_days: null, // Lifetime access
      manage_inventory: false,
      featured_image: 'https://example.com/images/research-collection.jpg',
      is_active: true,
      published_at: new Date()
    }
  });

  console.log('✅ Store items created');

  // Create sample coupons
  const welcomeCoupon = await prisma.coupons.upsert({
    where: { code: 'WELCOME10' },
    update: {},
    create: {
      code: 'WELCOME10',
      name: 'Welcome 10% Off',
      description: 'Welcome discount for new customers',
      discount_type: 'percentage',
      discount_value: 10,
      usage_limit: 1000,
      usage_limit_per_customer: 1,
      minimum_amount_cents: 1000, // Minimum $10.00 order
      maximum_discount_cents: 2000, // Max $20.00 discount
      starts_at: new Date(),
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
      is_active: true,
      created_by: 1 // Assuming admin user ID 1 exists
    }
  });

  const freeShippingCoupon = await prisma.coupons.upsert({
    where: { code: 'FREESHIP' },
    update: {},
    create: {
      code: 'FREESHIP',
      name: 'Free Shipping',
      description: 'Free shipping on orders over $25',
      discount_type: 'free_shipping',
      discount_value: 0,
      usage_limit: null, // Unlimited usage
      usage_limit_per_customer: null,
      minimum_amount_cents: 2500, // Minimum $25.00 order
      is_active: true,
      created_by: 1
    }
  });

  const holidayCoupon = await prisma.coupons.upsert({
    where: { code: 'HOLIDAY2025' },
    update: {},
    create: {
      code: 'HOLIDAY2025',
      name: 'Holiday Special 2025',
      description: 'Special holiday discount - $15 off orders over $50',
      discount_type: 'fixed_amount',
      discount_value: 1500, // $15.00 off
      usage_limit: 500,
      usage_limit_per_customer: 2,
      minimum_amount_cents: 5000, // Minimum $50.00 order
      starts_at: new Date('2025-12-01'),
      expires_at: new Date('2025-12-31'),
      is_active: true,
      created_by: 1
    }
  });

  console.log('✅ Coupons created');

  // Create coupon restrictions (holiday coupon only applies to physical items)
  await prisma.coupon_items.createMany({
    data: [
      { coupon_id: holidayCoupon.id, item_id: tshirt.id },
      { coupon_id: holidayCoupon.id, item_id: stickers.id }
    ],
    skipDuplicates: true
  });

  console.log('✅ Coupon restrictions created');

  // Update existing PaymentType enum in the database if needed
  // This would typically be done through a migration, but for seed data:
  try {
    await prisma.$executeRaw`
      DO $ 
      BEGIN
        -- Add new payment types if they don't exist
        IF NOT EXISTS (SELECT 1 FROM unnest(enum_range(NULL::PaymentType)) AS val WHERE val = 'store_purchase') THEN
          ALTER TYPE PaymentType ADD VALUE 'store_purchase';
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM unnest(enum_range(NULL::PaymentType)) AS val WHERE val = 'subscription_donation') THEN
          ALTER TYPE PaymentType ADD VALUE 'subscription_donation';
        END IF;
      END $;
    `;
    console.log('✅ PaymentType enum updated');
  } catch (error) {
    console.log('ℹ️ PaymentType enum values already exist or update not needed');
  }

  console.log('🎉 E-commerce seed data created successfully!');
  console.log('\n📊 Summary:');
  console.log(`• ${await prisma.store_categories.count()} categories created`);
  console.log(`• ${await prisma.store_items.count()} items created`);
  console.log(`• ${await prisma.store_item_variants.count()} variants created`);
  console.log(`• ${await prisma.coupons.count()} coupons created`);
  
  console.log('\n🛍️ Sample products available:');
  console.log('• Galway Institute T-Shirt ($29.99) - with size/color variants');
  console.log('• Sticker Pack ($8.99) - physical item');
  console.log('• Olive Branch Guide ($19.99) - digital download');
  console.log('• Research Collection ($49.99) - digital download');
  
  console.log('\n🎫 Coupons available:');
  console.log('• WELCOME10 - 10% off for new customers');
  console.log('• FREESHIP - Free shipping on orders over $25');
  console.log('• HOLIDAY2025 - $15 off orders over $50 (physical items only)');

  console.log('\n🚀 Ready to test the store!');
  console.log('Test endpoints:');
  console.log('• GET /api/store/categories');
  console.log('• GET /api/store/items');
  console.log('• GET /api/store/items/galway-institute-t-shirt');
  console.log('• POST /api/store/cart/add (authenticated)');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding data:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });