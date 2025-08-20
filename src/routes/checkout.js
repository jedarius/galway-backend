// src/routes/checkout.js
// Checkout and Payment Processing Routes
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const router = express.Router();
const prisma = new PrismaClient();

console.log('💳 Checkout and Payment routes loaded successfully!');

// Custom error classes
class ValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.statusCode = 400;
    this.code = 'VALIDATION_ERROR';
    this.details = details;
  }
}

class PaymentError extends Error {
  constructor(message, details = null) {
    super(message);
    this.statusCode = 402;
    this.code = 'PAYMENT_ERROR';
    this.details = details;
  }
}

// Helper function to generate order number
const generateOrderNumber = () => {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `GRI-${timestamp}-${random}`;
};

// Helper function to calculate shipping
const calculateShipping = (items, shippingAddress) => {
  const physicalItems = items.filter(item => 
    item.catalogItem?.physicalDetails?.requiresShipping
  );

  if (physicalItems.length === 0) return 0;

  // Calculate total weight
  const totalWeight = physicalItems.reduce((weight, item) => {
    const itemWeight = item.catalogItem.physicalDetails.shippingWeightGrams || 100;
    return weight + (itemWeight * item.quantity);
  }, 0);

  // Basic shipping calculation
  let shippingCents = 500; // Base $5.00

  if (totalWeight > 1000) shippingCents += 200; // +$2.00 for over 1kg
  if (totalWeight > 2000) shippingCents += 300; // +$3.00 for over 2kg

  // International shipping
  if (shippingAddress?.country && shippingAddress.country !== 'US') {
    shippingCents += 1000; // +$10.00 international
  }

  return shippingCents;
};

// Helper function to deliver digital items
const deliverDigitalItems = async (order, tx) => {
  const digitalItems = order.items.filter(item => 
    item.catalogItem?.itemType !== 'physical_item'
  );

  for (const item of digitalItems) {
    const catalogItem = item.catalogItem;
    
    if (catalogItem.itemType === 'seed') {
      // Add seeds to user inventory
      const existingSeeds = await tx.inventoryItem.findFirst({
        where: {
          userId: order.userId,
          itemType: 'seed',
          sourceType: 'purchase'
        }
      });

      if (existingSeeds) {
        await tx.inventoryItem.update({
          where: { id: existingSeeds.id },
          data: { quantity: { increment: item.quantity } }
        });
      } else {
        // Get next grid position
        const maxPosition = await tx.inventoryItem.findFirst({
          where: { userId: order.userId },
          orderBy: { gridPosition: 'desc' },
          select: { gridPosition: true }
        });

        const nextPosition = maxPosition?.gridPosition !== null && maxPosition?.gridPosition !== undefined
          ? maxPosition.gridPosition + 1
          : 0;

        await tx.inventoryItem.create({
          data: {
            userId: order.userId,
            itemType: 'seed',
            quantity: item.quantity,
            sourceType: 'purchase',
            sourceReference: `order-${order.orderNumber}`,
            gridPosition: nextPosition
          }
        });
      }
    } else if (catalogItem.itemType === 'digital_collectible') {
      // Handle different types of digital collectibles
      const digitalDetails = catalogItem.digitalDetails;
      
      if (digitalDetails.collectibleType === 'inventory_expansion') {
        // Expand user inventory (implement based on your inventory system)
        console.log(`🎒 Expanding inventory for user ${order.userId} by ${digitalDetails.slotsAdded} slots`);
      
      } else if (digitalDetails.collectibleType === 'generation_boost') {
        // Add generation boost to user
        await tx.userGenerationBoost.create({
          data: {
            userId: order.userId,
            boostId: digitalDetails.boostType, // You'll need to map this properly
            usesRemaining: digitalDetails.boostDurationHours || 24,
            expiresAt: new Date(Date.now() + (digitalDetails.boostDurationHours || 24) * 60 * 60 * 1000)
          }
        });
      
      } else if (digitalDetails.collectibleType === 'profile_theme') {
        // Add theme to user themes
        await tx.userTheme.create({
          data: {
            userId: order.userId,
            name: catalogItem.name,
            themeData: digitalDetails.themeData,
            isActive: false,
            isPublic: false
          }
        });
      }
    }

    // Mark item as delivered
    await tx.orderItem.update({
      where: { id: item.id },
      data: {
        isDelivered: true,
        deliveredAt: new Date(),
        digitalContent: {
          itemType: catalogItem.itemType,
          itemName: catalogItem.name,
          details: catalogItem.digitalDetails || catalogItem.seedDetails
        }
      }
    });
  }
};

// =============================================
// CHECKOUT FLOW
// =============================================

// POST /api/checkout/validate - Validate cart and calculate totals
router.post('/validate', requireAuth, [
  body('shippingAddress').optional().isObject(),
  body('shippingMethod').optional().isString()
], async (req, res, next) => {
  try {
    const { shippingAddress, shippingMethod } = req.body;

    // Get user's cart
    const cart = await prisma.cart.findUnique({
      where: { userId: req.user.id },
      include: {
        items: {
          include: {
            catalogItem: {
              include: {
                seedDetails: true,
                physicalDetails: true,
                digitalDetails: true
              }
            },
            branchListing: {
              include: {
                seller: { select: { username: true } },
                branch: true,
                bundleBranches: { include: { branch: true } }
              }
            }
          }
        }
      }
    });

    if (!cart || cart.items.length === 0) {
      throw new ValidationError('Cart is empty');
    }

    // Validate each item
    const validationErrors = [];
    let subtotalCents = 0;

    for (const item of cart.items) {
      if (item.catalogItem) {
        // Catalog item validation
        if (!item.catalogItem.isActive) {
          validationErrors.push(`Item "${item.catalogItem.name}" is no longer available`);
          continue;
        }

        // Stock check
        if (item.catalogItem.stockQuantity !== null && 
            item.catalogItem.stockQuantity < item.quantity) {
          validationErrors.push(`Insufficient stock for "${item.catalogItem.name}"`);
          continue;
        }

        // Price validation (check for price changes)
        if (item.priceAtTime !== item.catalogItem.priceCents) {
          validationErrors.push(`Price changed for "${item.catalogItem.name}"`);
        }

        subtotalCents += item.catalogItem.priceCents * item.quantity;

      } else if (item.branchListing) {
        // Marketplace item validation
        if (item.branchListing.status !== 'active') {
          validationErrors.push(`Branch listing is no longer available`);
          continue;
        }

        if (item.branchListing.sellerId === req.user.id) {
          validationErrors.push(`Cannot purchase your own listing`);
          continue;
        }

        subtotalCents += item.branchListing.priceCents * item.quantity;
      }
    }

    if (validationErrors.length > 0) {
      throw new ValidationError('Cart validation failed', validationErrors);
    }

    // Calculate shipping
    const shippingCents = calculateShipping(cart.items, shippingAddress);
    
    // Apply free shipping threshold
    const freeShippingThreshold = 5000; // $50.00
    const finalShippingCents = subtotalCents >= freeShippingThreshold ? 0 : shippingCents;

    // Calculate tax (implement based on your tax requirements)
    const taxCents = 0; // Add tax calculation logic

    const totalCents = subtotalCents + finalShippingCents + taxCents;

    // Check minimum order amount
    if (totalCents < 100) { // $1.00 minimum
      throw new ValidationError('Order total must be at least $1.00');
    }

    res.json({
      validation: {
        isValid: true,
        errors: []
      },
      totals: {
        subtotalCents,
        shippingCents: finalShippingCents,
        taxCents,
        totalCents,
        formatted: {
          subtotal: `$${(subtotalCents / 100).toFixed(2)}`,
          shipping: `$${(finalShippingCents / 100).toFixed(2)}`,
          tax: `$${(taxCents / 100).toFixed(2)}`,
          total: `$${(totalCents / 100).toFixed(2)}`
        }
      },
      freeShipping: subtotalCents >= freeShippingThreshold,
      requiresShipping: cart.items.some(item => 
        item.catalogItem?.physicalDetails?.requiresShipping
      )
    });

  } catch (error) {
    console.error('🔴 Error validating checkout:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        details: error.details
      });
    }
    next(error);
  }
});

// POST /api/checkout/create-payment-intent - Create Stripe payment intent
router.post('/create-payment-intent', requireAuth, [
  body('shippingAddress').optional().isObject(),
  body('saveAddress').optional().isBoolean()
], async (req, res, next) => {
  try {
    const { shippingAddress } = req.body;

    // Validate cart first
    const validationResponse = await fetch(`${req.protocol}://${req.get('host')}/api/checkout/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.authorization
      },
      body: JSON.stringify({ shippingAddress })
    });

    if (!validationResponse.ok) {
      const error = await validationResponse.json();
      throw new ValidationError('Cart validation failed', error.details);
    }

    const { totals } = await validationResponse.json();

    // Create Stripe payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totals.totalCents,
      currency: 'usd',
      metadata: {
        userId: req.user.id.toString(),
        orderType: 'catalog_purchase'
      },
      automatic_payment_methods: {
        enabled: true
      }
    });

    // Store payment record
    const payment = await prisma.payment.create({
      data: {
        userId: req.user.id,
        stripePaymentIntentId: paymentIntent.id,
        amountCents: totals.totalCents,
        currency: 'USD',
        paymentType: 'physical_item', // Update based on cart contents
        status: 'pending'
      }
    });

    console.log('🟢 Payment intent created:', paymentIntent.id, 'for user:', req.user.id);

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      paymentId: payment.id,
      amount: totals.formatted.total
    });

  } catch (error) {
    console.error('🔴 Error creating payment intent:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        details: error.details
      });
    }
    next(error);
  }
});

// POST /api/checkout/complete - Complete order after payment
router.post('/complete', requireAuth, [
  body('paymentIntentId').notEmpty().withMessage('Payment intent ID required'),
  body('shippingAddress').optional().isObject()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Invalid completion data', errors.array());
    }

    const { paymentIntentId, shippingAddress } = req.body;

    // Verify payment with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status !== 'succeeded') {
      throw new PaymentError('Payment not completed');
    }

    if (paymentIntent.metadata.userId !== req.user.id.toString()) {
      throw new PaymentError('Payment user mismatch');
    }

    // Get cart and create order
    const result = await prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({
        where: { userId: req.user.id },
        include: {
          items: {
            include: {
              catalogItem: {
                include: {
                  seedDetails: true,
                  physicalDetails: true,
                  digitalDetails: true
                }
              },
              branchListing: {
                include: {
                  seller: true,
                  branch: true,
                  bundleBranches: { include: { branch: true } }
                }
              }
            }
          }
        }
      });

      if (!cart || cart.items.length === 0) {
        throw new ValidationError('Cart is empty');
      }

      // Calculate totals
      let subtotalCents = 0;
      const orderItems = [];

      for (const item of cart.items) {
        let itemPrice = 0;
        let itemName = '';
        let itemType = 'seed';

        if (item.catalogItem) {
          itemPrice = item.catalogItem.priceCents;
          itemName = item.catalogItem.name;
          itemType = item.catalogItem.itemType;
          
          // Update stock
          if (item.catalogItem.stockQuantity !== null) {
            await tx.catalogItem.update({
              where: { id: item.catalogItem.id },
              data: { stockQuantity: { decrement: item.quantity } }
            });
          }

        } else if (item.branchListing) {
          itemPrice = item.branchListing.priceCents;
          itemName = `Branch: ${item.branchListing.branch?.botanicalId || 'Bundle'}`;
          itemType = 'branch_listing';

          // Handle marketplace purchase
          const { commissionCents, sellerEarnsCents } = calculateCommission(
            item.branchListing.priceCents, 
            item.branchListing.commissionPercentage
          );

          await tx.branchPurchase.create({
            data: {
              listingId: item.branchListing.id,
              buyerId: req.user.id,
              totalCents: itemPrice,
              commissionCents,
              sellerEarnsCents,
              status: 'pending'
            }
          });

          // Mark listing as sold
          await tx.branchListing.update({
            where: { id: item.branchListing.id },
            data: { 
              status: 'sold',
              soldAt: new Date()
            }
          });
        }

        subtotalCents += itemPrice * item.quantity;

        orderItems.push({
          catalogItemId: item.catalogItemId,
          itemName,
          itemType,
          quantity: item.quantity,
          unitPriceCents: itemPrice,
          totalPriceCents: itemPrice * item.quantity,
          selectedVariant: item.selectedVariant
        });
      }

      const shippingCents = calculateShipping(cart.items, shippingAddress);
      const finalShippingCents = subtotalCents >= 5000 ? 0 : shippingCents;
      const totalCents = subtotalCents + finalShippingCents;

      // Create order
      const order = await tx.order.create({
        data: {
          userId: req.user.id,
          orderNumber: generateOrderNumber(),
          status: 'pending',
          subtotalCents,
          shippingCents: finalShippingCents,
          taxCents: 0,
          totalCents,
          currency: 'USD',
          shippingAddress,
          shippingMethod: finalShippingCents > 0 ? 'standard' : 'free'
        }
      });

      // Create order items
      for (const itemData of orderItems) {
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            ...itemData
          }
        });
      }

      // Update payment record
      await tx.payment.update({
        where: { stripePaymentIntentId: paymentIntentId },
        data: {
          status: 'succeeded',
          completedAt: new Date(),
          referenceId: order.id
        }
      });

      // Get complete order for digital delivery
      const completeOrder = await tx.order.findUnique({
        where: { id: order.id },
        include: {
          items: {
            include: {
              catalogItem: {
                include: {
                  seedDetails: true,
                  digitalDetails: true
                }
              }
            }
          }
        }
      });

      // Deliver digital items immediately
      await deliverDigitalItems(completeOrder, tx);

      // Clear cart
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id }
      });

      return order;
    });

    console.log('🟢 Order completed:', result.orderNumber, 'for user:', req.user.id);

    res.json({
      message: 'Order completed successfully!',
      order: {
        id: result.id,
        orderNumber: result.orderNumber,
        total: `$${(result.totalCents / 100).toFixed(2)}`,
        status: result.status
      },
      redirectUrl: `/orders/${result.orderNumber}`
    });

  } catch (error) {
    console.error('🔴 Error completing order:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        details: error.details
      });
    }
    next(error);
  }
});

// =============================================
// MARKETPLACE PURCHASE ROUTES
// =============================================

// POST /api/checkout/marketplace/purchase - Direct marketplace purchase
router.post('/marketplace/purchase', requireAuth, [
  body('listingId').isInt().withMessage('Valid listing ID required')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError('Invalid purchase data', errors.array());
    }

    const { listingId } = req.body;

    const listing = await prisma.branchListing.findFirst({
      where: {
        id: listingId,
        status: 'active',
        sellerId: { not: req.user.id }
      },
      include: {
        seller: { select: { username: true } },
        branch: true,
        bundleBranches: { include: { branch: true } }
      }
    });

    if (!listing) {
      throw new ValidationError('Listing not available for purchase');
    }

    // Create Stripe payment intent for marketplace purchase
    const paymentIntent = await stripe.paymentIntents.create({
      amount: listing.priceCents,
      currency: 'usd',
      metadata: {
        userId: req.user.id.toString(),
        listingId: listingId.toString(),
        orderType: 'marketplace_purchase'
      },
      automatic_payment_methods: {
        enabled: true
      }
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      listing: {
        id: listing.id,
        title: listing.title,
        price: `$${(listing.priceCents / 100).toFixed(2)}`,
        seller: listing.seller.username,
        isBundle: listing.isBundle,
        branchCount: listing.isBundle ? listing.bundleBranches.length : 1
      }
    });

  } catch (error) {
    console.error('🔴 Error creating marketplace purchase:', error);
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        details: error.details
      });
    }
    next(error);
  }
});

// Helper function to calculate commission for marketplace
const calculateCommission = (priceCents, commissionPercentage = 5.0) => {
  const commissionCents = Math.round(priceCents * (commissionPercentage / 100));
  const sellerEarnsCents = priceCents - commissionCents;
  return { commissionCents, sellerEarnsCents };
};

module.exports = router;