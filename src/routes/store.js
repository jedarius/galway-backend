// src/routes/store.js - CORRECTED ResponseWrapper Usage
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const AuthMiddleware = require('../middleware/auth');
// CORRECT import - your ResponseWrapper is a static class
const { ResponseWrapper } = require('../middleware/errorHandler');
const stripeService = require('../services/stripeService');
const crypto = require('crypto');

const router = express.Router();
const prisma = new PrismaClient();

// Helper function to generate order number
const generateOrderNumber = () => {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
  return `ORD-${year}-${random}`;
};

/**
 * @route GET /api/store/test
 * @desc Test endpoint to verify store is working
 * @access Public
 */
router.get('/test', (req, res) => {
  return ResponseWrapper.success(res, {
    message: 'Store API is working!',
    timestamp: new Date().toISOString(),
    features: {
      categories: '/api/store/categories',
      items: '/api/store/items', 
      cart: '/api/store/cart (auth required)',
      checkout: '/api/store/checkout (auth required)'
    }
  }, 'Store API test successful');
});

/**
 * @route GET /api/store/categories
 * @desc Get all store categories
 * @access Public
 */
router.get('/categories', async (req, res) => {
  try {
    const { item_type } = req.query;
    
    const categories = await prisma.store_categories.findMany({
      where: {
        is_active: true,
        ...(item_type && { item_type })
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        item_type: true,
        display_order: true,
        parent_id: true,
        _count: {
          select: {
            store_items: {
              where: { is_active: true }
            }
          }
        }
      },
      orderBy: [
        { display_order: 'asc' },
        { name: 'asc' }
      ]
    });

    return ResponseWrapper.success(res, {
      categories,
      total: categories.length,
      filters: { item_type }
    }, 'Categories retrieved successfully');

  } catch (error) {
    console.error('Error fetching categories:', error);
    return ResponseWrapper.error(res, 'Failed to fetch categories', 500, 'FETCH_CATEGORIES_FAILED');
  }
});

/**
 * @route GET /api/store/items
 * @desc Get store items with filtering and pagination
 * @access Public
 */
router.get('/items', async (req, res) => {
  try {
    const {
      category_id,
      item_type,
      featured,
      search,
      sort = 'created_at',
      order = 'desc',
      page = 1,
      limit = 20
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // Build where conditions
    const where = {
      is_active: true,
      published_at: { lte: new Date() },
      ...(category_id && { category_id: parseInt(category_id) }),
      ...(item_type && { item_type }),
      ...(featured && { is_featured: featured === 'true' }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { short_description: { contains: search, mode: 'insensitive' } }
        ]
      })
    };

    // Build order by
    const orderBy = {};
    orderBy[sort] = order;

    const [items, totalCount] = await Promise.all([
      prisma.store_items.findMany({
        where,
        include: {
          category: {
            select: { id: true, name: true, slug: true }
          },
          variants: {
            where: { is_active: true },
            select: {
              id: true,
              name: true,
              options: true,
              price_cents: true,
              stock_quantity: true
            }
          },
          _count: {
            select: { variants: true }
          }
        },
        orderBy,
        skip,
        take
      }),
      prisma.store_items.count({ where })
    ]);

    return ResponseWrapper.success(res, {
      items: items.map(item => ({
        ...item,
        price_formatted: `$${(item.price_cents / 100).toFixed(2)}`,
        compare_at_price_formatted: item.compare_at_price_cents 
          ? `$${(item.compare_at_price_cents / 100).toFixed(2)}` 
          : null,
        in_stock: item.manage_inventory ? item.stock_quantity > 0 : true,
        low_stock: item.manage_inventory && item.low_stock_threshold 
          ? item.stock_quantity <= item.low_stock_threshold 
          : false
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit))
      },
      filters: { category_id, item_type, featured, search, sort, order }
    }, 'Store items retrieved successfully');

  } catch (error) {
    console.error('Error fetching store items:', error);
    return ResponseWrapper.error(res, 'Failed to fetch store items', 500, 'FETCH_ITEMS_FAILED');
  }
});

/**
 * @route GET /api/store/items/:slug
 * @desc Get single store item by slug
 * @access Public
 */
router.get('/items/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const item = await prisma.store_items.findUnique({
      where: { 
        slug,
        is_active: true,
        published_at: { lte: new Date() }
      },
      include: {
        category: {
          select: { id: true, name: true, slug: true }
        },
        variants: {
          where: { is_active: true },
          orderBy: { id: 'asc' }
        }
      }
    });

    if (!item) {
      return ResponseWrapper.error(res, 'Store item not found', 404, 'ITEM_NOT_FOUND');
    }

    return ResponseWrapper.success(res, {
      ...item,
      price_formatted: `$${(item.price_cents / 100).toFixed(2)}`,
      compare_at_price_formatted: item.compare_at_price_cents 
        ? `$${(item.compare_at_price_cents / 100).toFixed(2)}` 
        : null,
      in_stock: item.manage_inventory ? item.stock_quantity > 0 : true,
      low_stock: item.manage_inventory && item.low_stock_threshold 
        ? item.stock_quantity <= item.low_stock_threshold 
        : false,
      variants: item.variants.map(variant => ({
        ...variant,
        price_formatted: variant.price_cents 
          ? `$${(variant.price_cents / 100).toFixed(2)}` 
          : `$${(item.price_cents / 100).toFixed(2)}`,
        in_stock: variant.stock_quantity > 0
      }))
    }, 'Store item retrieved successfully');

  } catch (error) {
    console.error('Error fetching store item:', error);
    return ResponseWrapper.error(res, 'Failed to fetch store item', 500, 'FETCH_ITEM_FAILED');
  }
});

/**
 * @route POST /api/store/cart/add
 * @desc Add item to cart
 * @access Private
 */
router.post('/cart/add', AuthMiddleware.requireAuth, async (req, res) => {
  try {
    const { item_id, variant_id, quantity = 1 } = req.body;
    const userId = req.user.id;

    // Validate item exists and is active
    const item = await prisma.store_items.findUnique({
      where: { id: parseInt(item_id), is_active: true },
      include: {
        variants: variant_id ? {
          where: { id: parseInt(variant_id) }
        } : false
      }
    });

    if (!item) {
      return ResponseWrapper.error(res, 'Item not found', 404, 'ITEM_NOT_FOUND');
    }

    // Validate variant if specified
    let variant = null;
    if (variant_id) {
      variant = item.variants?.[0];
      if (!variant) {
        return ResponseWrapper.error(res, 'Variant not found', 404, 'VARIANT_NOT_FOUND');
      }
    }

    // Check inventory
    const currentStock = variant ? variant.stock_quantity : item.stock_quantity;
    if (item.manage_inventory && currentStock < quantity) {
      return ResponseWrapper.error(res, 'Insufficient inventory', 400, 'INSUFFICIENT_INVENTORY');
    }

    // Determine price
    const unitPrice = variant?.price_cents || item.price_cents;

    // Create or update cart item
    const cartItem = await prisma.cart_items.upsert({
      where: {
        user_id_item_id_variant_id: {
          user_id: userId,
          item_id: parseInt(item_id),
          variant_id: variant_id ? parseInt(variant_id) : null
        }
      },
      update: {
        quantity: { increment: parseInt(quantity) },
        unit_price_cents: unitPrice,
        updated_at: new Date()
      },
      create: {
        user_id: userId,
        item_id: parseInt(item_id),
        variant_id: variant_id ? parseInt(variant_id) : null,
        quantity: parseInt(quantity),
        unit_price_cents: unitPrice
      },
      include: {
        item: {
          select: { name: true, slug: true, featured_image: true }
        },
        variant: {
          select: { name: true, options: true }
        }
      }
    });

    return ResponseWrapper.success(res, {
      ...cartItem,
      total_price_cents: cartItem.quantity * cartItem.unit_price_cents,
      total_price_formatted: `$${((cartItem.quantity * cartItem.unit_price_cents) / 100).toFixed(2)}`,
      unit_price_formatted: `$${(cartItem.unit_price_cents / 100).toFixed(2)}`
    }, 'Item added to cart successfully');

  } catch (error) {
    console.error('Error adding to cart:', error);
    return ResponseWrapper.error(res, 'Failed to add item to cart', 500, 'ADD_TO_CART_FAILED');
  }
});

/**
 * @route GET /api/store/cart
 * @desc Get user's cart
 * @access Private
 */
router.get('/cart', AuthMiddleware.requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const cartItems = await prisma.cart_items.findMany({
      where: { user_id: userId },
      include: {
        item: {
          select: {
            id: true,
            name: true,
            slug: true,
            featured_image: true,
            item_type: true,
            manage_inventory: true,
            stock_quantity: true,
            is_active: true
          }
        },
        variant: {
          select: {
            id: true,
            name: true,
            options: true,
            stock_quantity: true,
            is_active: true
          }
        }
      },
      orderBy: { created_at: 'asc' }
    });

    // Filter out inactive items and calculate totals
    const activeCartItems = cartItems.filter(item => 
      item.item.is_active && (!item.variant || item.variant.is_active)
    );

    const cartSummary = {
      subtotal_cents: 0,
      total_items: 0,
      total_quantity: 0
    };

    const formattedItems = activeCartItems.map(cartItem => {
      const totalPrice = cartItem.quantity * cartItem.unit_price_cents;
      cartSummary.subtotal_cents += totalPrice;
      cartSummary.total_items += 1;
      cartSummary.total_quantity += cartItem.quantity;

      // Check current inventory
      const currentStock = cartItem.variant 
        ? cartItem.variant.stock_quantity 
        : cartItem.item.stock_quantity;
      
      const available = !cartItem.item.manage_inventory || currentStock >= cartItem.quantity;

      return {
        ...cartItem,
        total_price_cents: totalPrice,
        total_price_formatted: `$${(totalPrice / 100).toFixed(2)}`,
        unit_price_formatted: `$${(cartItem.unit_price_cents / 100).toFixed(2)}`,
        available,
        max_available: cartItem.item.manage_inventory ? currentStock : 999
      };
    });

    return ResponseWrapper.success(res, {
      items: formattedItems,
      summary: {
        ...cartSummary,
        subtotal_formatted: `$${(cartSummary.subtotal_cents / 100).toFixed(2)}`
      }
    }, 'Cart retrieved successfully');

  } catch (error) {
    console.error('Error fetching cart:', error);
    return ResponseWrapper.error(res, 'Failed to fetch cart', 500, 'FETCH_CART_FAILED');
  }
});

/**
 * @route DELETE /api/store/cart/:id
 * @desc Remove item from cart
 * @access Private
 */
router.delete('/cart/:id', AuthMiddleware.requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    await prisma.cart_items.delete({
      where: {
        id: parseInt(id),
        user_id: userId
      }
    });

    return ResponseWrapper.success(res, { 
      removed_item_id: parseInt(id) 
    }, 'Item removed from cart successfully');

  } catch (error) {
    console.error('Error removing cart item:', error);
    return ResponseWrapper.error(res, 'Failed to remove cart item', 500, 'REMOVE_CART_ITEM_FAILED');
  }
});

module.exports = router;