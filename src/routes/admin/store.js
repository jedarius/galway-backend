// src/routes/admin/store.js
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const AuthMiddleware = require('../../middleware/auth');
const ResponseWrapper = require('../../middleware/errorHandler').ResponseWrapper;
const stripeService = require('../../services/stripeService');

const router = express.Router();
const prisma = new PrismaClient();

// Apply admin authentication to all routes
router.use(AuthMiddleware.requireAdmin);

// Helper function to generate slug
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
};

/**
 * @route GET /api/admin/store/dashboard
 * @desc Get store dashboard analytics
 * @access Admin
 */
router.get('/dashboard', async (req, res) => {
  const responseWrapper = new ResponseWrapper(req, res, 'retrieve', 'store dashboard');

  try {
    const { period = '30' } = req.query; // days
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    const [
      totalOrders,
      totalRevenue,
      recentOrders,
      topProducts,
      orderStatusCounts,
      dailyStats
    ] = await Promise.all([
      // Total orders count
      prisma.orders.count({
        where: {
          created_at: { gte: startDate }
        }
      }),
      
      // Total revenue
      prisma.orders.aggregate({
        where: {
          created_at: { gte: startDate },
          payment_status: 'succeeded'
        },
        _sum: { total_cents: true }
      }),
      
      // Recent orders
      prisma.orders.findMany({
        take: 10,
        orderBy: { created_at: 'desc' },
        include: {
          user: {
            select: { username: true, email: true }
          },
          order_items: {
            select: { quantity: true }
          }
        }
      }),
      
      // Top selling products
      prisma.order_items.groupBy({
        by: ['item_id'],
        _sum: { quantity: true },
        _count: { id: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 5,
        where: {
          order: {
            created_at: { gte: startDate },
            payment_status: 'succeeded'
          }
        }
      }),
      
      // Order status distribution
      prisma.orders.groupBy({
        by: ['status'],
        _count: { id: true },
        where: {
          created_at: { gte: startDate }
        }
      }),
      
      // Daily sales stats
      prisma.$queryRaw`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as orders,
          SUM(total_cents) as revenue_cents
        FROM orders 
        WHERE created_at >= ${startDate}
          AND payment_status = 'succeeded'
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `
    ]);

    // Fetch product details for top products
    const topProductIds = topProducts.map(p => p.item_id);
    const productDetails = await prisma.store_items.findMany({
      where: { id: { in: topProductIds } },
      select: { id: true, name: true, price_cents: true, featured_image: true }
    });

    const topProductsWithDetails = topProducts.map(stat => {
      const product = productDetails.find(p => p.id === stat.item_id);
      return {
        ...product,
        total_sold: stat._sum.quantity,
        total_orders: stat._count.id,
        revenue_cents: stat._sum.quantity * (product?.price_cents || 0)
      };
    });

    return responseWrapper.success({
      overview: {
        total_orders: totalOrders,
        total_revenue_cents: totalRevenue._sum.total_cents || 0,
        total_revenue_formatted: `$${((totalRevenue._sum.total_cents || 0) / 100).toFixed(2)}`,
        period_days: parseInt(period)
      },
      recent_orders: recentOrders.map(order => ({
        ...order,
        total_formatted: `$${(order.total_cents / 100).toFixed(2)}`,
        item_count: order.order_items.reduce((sum, item) => sum + item.quantity, 0)
      })),
      top_products: topProductsWithDetails,
      order_status_counts,
      daily_stats: dailyStats.map(stat => ({
        date: stat.date,
        orders: Number(stat.orders),
        revenue_cents: Number(stat.revenue_cents),
        revenue_formatted: `$${(Number(stat.revenue_cents) / 100).toFixed(2)}`
      }))
    });
  } catch (error) {
    console.error('Error fetching store dashboard:', error);
    return responseWrapper.error('Failed to fetch dashboard data', 500, 'DASHBOARD_FETCH_FAILED');
  }
});

/**
 * @route GET /api/admin/store/categories
 * @desc Get all categories for admin
 * @access Admin
 */
router.get('/categories', async (req, res) => {
  const responseWrapper = new ResponseWrapper(req, res, 'retrieve', 'categories');

  try {
    const categories = await prisma.store_categories.findMany({
      include: {
        _count: {
          select: { store_items: true }
        },
        parent_category: {
          select: { id: true, name: true }
        }
      },
      orderBy: [
        { display_order: 'asc' },
        { name: 'asc' }
      ]
    });

    return responseWrapper.success({ categories });
  } catch (error) {
    console.error('Error fetching categories:', error);
    return responseWrapper.error('Failed to fetch categories', 500, 'FETCH_CATEGORIES_FAILED');
  }
});

/**
 * @route POST /api/admin/store/categories
 * @desc Create new category
 * @access Admin
 */
router.post('/categories', async (req, res) => {
  const responseWrapper = new ResponseWrapper(req, res, 'create', 'category');

  try {
    const { name, description, parent_id, item_type, display_order } = req.body;

    if (!name) {
      return responseWrapper.error('Category name is required', 400, 'MISSING_NAME');
    }

    const slug = generateSlug(name);

    // Check if slug already exists
    const existingCategory = await prisma.store_categories.findUnique({
      where: { slug }
    });

    if (existingCategory) {
      return responseWrapper.error('Category with this name already exists', 400, 'DUPLICATE_CATEGORY');
    }

    const category = await prisma.store_categories.create({
      data: {
        name,
        slug,
        description,
        parent_id: parent_id ? parseInt(parent_id) : null,
        item_type: item_type || 'physical',
        display_order: display_order ? parseInt(display_order) : 0
      },
      include: {
        parent_category: {
          select: { id: true, name: true }
        }
      }
    });

    return responseWrapper.success(category);
  } catch (error) {
    console.error('Error creating category:', error);
    return responseWrapper.error('Failed to create category', 500, 'CREATE_CATEGORY_FAILED');
  }
});

/**
 * @route PUT /api/admin/store/categories/:id
 * @desc Update category
 * @access Admin
 */
router.put('/categories/:id', async (req, res) => {
  const responseWrapper = new ResponseWrapper(req, res, 'update', 'category');

  try {
    const { id } = req.params;
    const { name, description, parent_id, item_type, display_order, is_active } = req.body;

    const updateData = {};
    if (name) {
      updateData.name = name;
      updateData.slug = generateSlug(name);
    }
    if (description !== undefined) updateData.description = description;
    if (parent_id !== undefined) updateData.parent_id = parent_id ? parseInt(parent_id) : null;
    if (item_type) updateData.item_type = item_type;
    if (display_order !== undefined) updateData.display_order = parseInt(display_order);
    if (is_active !== undefined) updateData.is_active = is_active;
    updateData.updated_at = new Date();

    const category = await prisma.store_categories.update({
      where: { id: parseInt(id) },
      data: updateData,
      include: {
        parent_category: {
          select: { id: true, name: true }
        }
      }
    });

    return responseWrapper.success(category);
  } catch (error) {
    console.error('Error updating category:', error);
    return responseWrapper.error('Failed to update category', 500, 'UPDATE_CATEGORY_FAILED');
  }
});

/**
 * @route GET /api/admin/store/items
 * @desc Get all store items for admin
 * @access Admin
 */
router.get('/items', async (req, res) => {
  const responseWrapper = new ResponseWrapper(req, res, 'retrieve', 'store items');

  try {
    const {
      category_id,
      item_type,
      is_active,
      search,
      sort = 'created_at',
      order = 'desc',
      page = 1,
      limit = 20
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {
      ...(category_id && { category_id: parseInt(category_id) }),
      ...(item_type && { item_type }),
      ...(is_active !== undefined && { is_active: is_active === 'true' }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } }
        ]
      })
    };

    const orderBy = {};
    orderBy[sort] = order;

    const [items, totalCount] = await Promise.all([
      prisma.store_items.findMany({
        where,
        include: {
          category: {
            select: { id: true, name: true }
          },
          variants: {
            select: { id: true, name: true, stock_quantity: true }
          },
          _count: {
            select: {
              variants: true,
              order_items: true
            }
          }
        },
        orderBy,
        skip,
        take
      }),
      prisma.store_items.count({ where })
    ]);

    return responseWrapper.success({
      items: items.map(item => ({
        ...item,
        price_formatted: `$${(item.price_cents / 100).toFixed(2)}`,
        total_sold: item._count.order_items,
        low_stock: item.manage_inventory && item.low_stock_threshold 
          ? item.stock_quantity <= item.low_stock_threshold 
          : false
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching store items:', error);
    return responseWrapper.error('Failed to fetch store items', 500, 'FETCH_ITEMS_FAILED');
  }
});

/**
 * @route POST /api/admin/store/items
 * @desc Create new store item
 * @access Admin
 */
router.post('/items', async (req, res) => {
  const responseWrapper = new ResponseWrapper(req, res, 'create', 'store item');

  try {
    const {
      name,
      description,
      short_description,
      category_id,
      item_type,
      price_cents,
      compare_at_price_cents,
      weight_grams,
      requires_shipping = true,
      download_url,
      download_limit,
      access_duration_days,
      manage_inventory = false,
      stock_quantity = 0,
      low_stock_threshold,
      allow_backorder = false,
      meta_title,
      meta_description,
      images,
      featured_image,
      is_featured = false,
      variants = []
    } = req.body;

    if (!name || !category_id || !price_cents) {
      return responseWrapper.error('Name, category, and price are required', 400, 'MISSING_REQUIRED_FIELDS');
    }

    const slug = generateSlug(name);

    // Check if slug already exists
    const existingItem = await prisma.store_items.findUnique({
      where: { slug }
    });

    if (existingItem) {
      return responseWrapper.error('Item with this name already exists', 400, 'DUPLICATE_ITEM');
    }

    const item = await prisma.store_items.create({
      data: {
        name,
        slug,
        description,
        short_description,
        category_id: parseInt(category_id),
        item_type,
        price_cents: parseInt(price_cents),
        compare_at_price_cents: compare_at_price_cents ? parseInt(compare_at_price_cents) : null,
        weight_grams: weight_grams ? parseInt(weight_grams) : null,
        requires_shipping: item_type === 'physical' ? requires_shipping : false,
        download_url: item_type === 'digital' ? download_url : null,
        download_limit: item_type === 'digital' && download_limit ? parseInt(download_limit) : null,
        access_duration_days: item_type === 'digital' && access_duration_days ? parseInt(access_duration_days) : null,
        manage_inventory,
        stock_quantity: parseInt(stock_quantity),
        low_stock_threshold: low_stock_threshold ? parseInt(low_stock_threshold) : null,
        allow_backorder,
        meta_title,
        meta_description,
        images,
        featured_image,
        is_featured,
        published_at: new Date(),
        variants: {
          create: variants.map(variant => ({
            name: variant.name,
            sku: variant.sku,
            price_cents: variant.price_cents ? parseInt(variant.price_cents) : null,
            options: variant.options,
            stock_quantity: variant.stock_quantity ? parseInt(variant.stock_quantity) : 0,
            weight_grams: variant.weight_grams ? parseInt(variant.weight_grams) : null
          }))
        }
      },
      include: {
        category: {
          select: { id: true, name: true }
        },
        variants: true
      }
    });

    return responseWrapper.success(item);
  } catch (error) {
    console.error('Error creating store item:', error);
    return responseWrapper.error('Failed to create store item', 500, 'CREATE_ITEM_FAILED');
  }
});

/**
 * @route PUT /api/admin/store/items/:id
 * @desc Update store item
 * @access Admin
 */
router.put('/items/:id', async (req, res) => {
  const responseWrapper = new ResponseWrapper(req, res, 'update', 'store item');

  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    delete updateData.variants; // Handle variants separately

    if (updateData.name) {
      updateData.slug = generateSlug(updateData.name);
    }

    // Convert string numbers to integers
    const numericFields = ['price_cents', 'compare_at_price_cents', 'weight_grams', 'download_limit', 'access_duration_days', 'stock_quantity', 'low_stock_threshold'];
    numericFields.forEach(field => {
      if (updateData[field] !== undefined && updateData[field] !== null) {
        updateData[field] = parseInt(updateData[field]);
      }
    });

    updateData.updated_at = new Date();

    const item = await prisma.store_items.update({
      where: { id: parseInt(id) },
      data: updateData,
      include: {
        category: {
          select: { id: true, name: true }
        },
        variants: true
      }
    });

    return responseWrapper.success(item);
  } catch (error) {
    console.error('Error updating store item:', error);
    return responseWrapper.error('Failed to update store item', 500, 'UPDATE_ITEM_FAILED');
  }
});

/**
 * @route GET /api/admin/store/orders
 * @desc Get all orders for admin
 * @access Admin
 */
router.get('/orders', async (req, res) => {
  const responseWrapper = new ResponseWrapper(req, res, 'retrieve', 'orders');

  try {
    const {
      status,
      payment_status,
      fulfillment_status,
      search,
      start_date,
      end_date,
      page = 1,
      limit = 20
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {
      ...(status && { status }),
      ...(payment_status && { payment_status }),
      ...(fulfillment_status && { fulfillment_status }),
      ...(start_date && end_date && {
        created_at: {
          gte: new Date(start_date),
          lte: new Date(end_date)
        }
      }),
      ...(search && {
        OR: [
          { order_number: { contains: search, mode: 'insensitive' } },
          { user: { username: { contains: search, mode: 'insensitive' } } },
          { user: { email: { contains: search, mode: 'insensitive' } } }
        ]
      })
    };

    const [orders, totalCount] = await Promise.all([
      prisma.orders.findMany({
        where,
        include: {
          user: {
            select: { id: true, username: true, email: true }
          },
          order_items: {
            include: {
              item: {
                select: { name: true, featured_image: true }
              }
            }
          },
          coupon: {
            select: { code: true, discount_type: true, discount_value: true }
          }
        },
        orderBy: { created_at: 'desc' },
        skip,
        take
      }),
      prisma.orders.count({ where })
    ]);

    return responseWrapper.success({
      orders: orders.map(order => ({
        ...order,
        total_formatted: `$${(order.total_cents / 100).toFixed(2)}`,
        item_count: order.order_items.reduce((sum, item) => sum + item.quantity, 0)
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    return responseWrapper.error('Failed to fetch orders', 500, 'FETCH_ORDERS_FAILED');
  }
});

/**
 * @route PUT /api/admin/store/orders/:id/status
 * @desc Update order status
 * @access Admin
 */
router.put('/orders/:id/status', async (req, res) => {
  const responseWrapper = new ResponseWrapper(req, res, 'update', 'order status');

  try {
    const { id } = req.params;
    const { status, fulfillment_status, tracking_number, tracking_url, notes } = req.body;

    const order = await prisma.orders.findUnique({
      where: { id: parseInt(id) }
    });

    if (!order) {
      return responseWrapper.error('Order not found', 404, 'ORDER_NOT_FOUND');
    }

    const updateData = {
      updated_at: new Date()
    };

    if (status) updateData.status = status;
    if (fulfillment_status) updateData.fulfillment_status = fulfillment_status;
    if (tracking_number) updateData.tracking_number = tracking_number;
    if (tracking_url) updateData.tracking_url = tracking_url;
    if (notes) updateData.admin_notes = notes;

    // Set timestamps based on status
    if (status === 'shipped' && !order.shipped_at) {
      updateData.shipped_at = new Date();
    }
    if (status === 'delivered' && !order.delivered_at) {
      updateData.delivered_at = new Date();
    }
    if (status === 'cancelled' && !order.cancelled_at) {
      updateData.cancelled_at = new Date();
    }

    const updatedOrder = await prisma.orders.update({
      where: { id: parseInt(id) },
      data: updateData,
      include: {
        user: {
          select: { id: true, username: true, email: true }
        },
        order_items: {
          include: {
            item: {
              select: { name: true }
            }
          }
        }
      }
    });

    // Add status history
    await prisma.order_status_history.create({
      data: {
        order_id: parseInt(id),
        from_status: order.status,
        to_status: status || order.status,
        notes,
        created_by: req.user.id
      }
    });

    // Send notification to customer
    if (status) {
      await prisma.notifications.create({
        data: {
          user_id: order.user_id,
          type: status === 'shipped' ? 'trade_confirmed' : 'admin_announcement',
          title: `Order ${status}`,
          message: `Your order ${order.order_number} is now ${status}.`,
          action_url: `/orders/${order.order_number}`
        }
      });
    }

    return responseWrapper.success({
      ...updatedOrder,
      total_formatted: `$${(updatedOrder.total_cents / 100).toFixed(2)}`
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    return responseWrapper.error('Failed to update order status', 500, 'UPDATE_ORDER_STATUS_FAILED');
  }
});

/**
 * @route POST /api/admin/store/orders/:id/refund
 * @desc Process order refund
 * @access Admin
 */
router.post('/orders/:id/refund', async (req, res) => {
  const responseWrapper = new ResponseWrapper(req, res, 'create', 'refund');

  try {
    const { id } = req.params;
    const { amount_cents, reason = 'requested_by_customer' } = req.body;

    const refund = await stripeService.refundOrder(parseInt(id), amount_cents, reason);

    return responseWrapper.success({
      refund: {
        id: refund.id,
        amount: refund.amount,
        status: refund.status,
        reason: refund.reason
      },
      message: 'Refund processed successfully'
    });
  } catch (error) {
    console.error('Error processing refund:', error);
    return responseWrapper.error('Failed to process refund', 500, 'REFUND_FAILED');
  }
});

/**
 * @route GET /api/admin/store/coupons
 * @desc Get all coupons
 * @access Admin
 */
router.get('/coupons', async (req, res) => {
  const responseWrapper = new ResponseWrapper(req, res, 'retrieve', 'coupons');

  try {
    const { is_active, search, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {
      ...(is_active !== undefined && { is_active: is_active === 'true' }),
      ...(search && {
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } }
        ]
      })
    };

    const [coupons, totalCount] = await Promise.all([
      prisma.coupons.findMany({
        where,
        include: {
          admin: {
            select: { username: true }
          },
          _count: {
            select: { usage_log: true }
          }
        },
        orderBy: { created_at: 'desc' },
        skip,
        take
      }),
      prisma.coupons.count({ where })
    ]);

    return responseWrapper.success({
      coupons: coupons.map(coupon => ({
        ...coupon,
        usage_percentage: coupon.usage_limit 
          ? Math.round((coupon.current_uses / coupon.usage_limit) * 100)
          : 0,
        discount_formatted: coupon.discount_type === 'percentage' 
          ? `${coupon.discount_value}%` 
          : `$${(coupon.discount_value / 100).toFixed(2)}`
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching coupons:', error);
    return responseWrapper.error('Failed to fetch coupons', 500, 'FETCH_COUPONS_FAILED');
  }
});

/**
 * @route POST /api/admin/store/coupons
 * @desc Create new coupon
 * @access Admin
 */
router.post('/coupons', async (req, res) => {
  const responseWrapper = new ResponseWrapper(req, res, 'create', 'coupon');

  try {
    const {
      code,
      name,
      description,
      discount_type,
      discount_value,
      usage_limit,
      usage_limit_per_customer,
      minimum_amount_cents,
      maximum_discount_cents,
      starts_at,
      expires_at,
      applicable_item_ids = []
    } = req.body;

    if (!code || !name || !discount_type || !discount_value) {
      return responseWrapper.error('Code, name, discount type, and discount value are required', 400, 'MISSING_REQUIRED_FIELDS');
    }

    // Check if code already exists
    const existingCoupon = await prisma.coupons.findUnique({
      where: { code: code.toUpperCase() }
    });

    if (existingCoupon) {
      return responseWrapper.error('Coupon code already exists', 400, 'DUPLICATE_CODE');
    }

    const coupon = await prisma.coupons.create({
      data: {
        code: code.toUpperCase(),
        name,
        description,
        discount_type,
        discount_value: parseInt(discount_value),
        usage_limit: usage_limit ? parseInt(usage_limit) : null,
        usage_limit_per_customer: usage_limit_per_customer ? parseInt(usage_limit_per_customer) : null,
        minimum_amount_cents: minimum_amount_cents ? parseInt(minimum_amount_cents) : null,
        maximum_discount_cents: maximum_discount_cents ? parseInt(maximum_discount_cents) : null,
        starts_at: starts_at ? new Date(starts_at) : null,
        expires_at: expires_at ? new Date(expires_at) : null,
        created_by: req.user.id,
        applicable_items: applicable_item_ids.length > 0 ? {
          create: applicable_item_ids.map(itemId => ({
            item_id: parseInt(itemId)
          }))
        } : undefined
      },
      include: {
        admin: {
          select: { username: true }
        },
        applicable_items: {
          include: {
            item: {
              select: { name: true }
            }
          }
        }
      }
    });

    return responseWrapper.success(coupon);
  } catch (error) {
    console.error('Error creating coupon:', error);
    return responseWrapper.error('Failed to create coupon', 500, 'CREATE_COUPON_FAILED');
  }
});

module.exports = router;