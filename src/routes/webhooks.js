// src/routes/webhooks.js
const express = require('express');
const stripeService = require('../services/stripeService');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Stripe requires raw body for webhook signature verification
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * @route POST /api/webhooks/stripe
 * @desc Handle Stripe webhook events
 * @access Public (but authenticated via Stripe signature)
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`Received Stripe webhook: ${event.type}`);

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object);
        break;

      case 'payment_intent.canceled':
        await handlePaymentIntentCanceled(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object);
        break;

      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      case 'charge.dispute.created':
        await handleChargeDisputeCreated(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
});

/**
 * Handle successful payment intent
 */
async function handlePaymentIntentSucceeded(paymentIntent) {
  try {
    await stripeService.handlePaymentSuccess(paymentIntent);
    
    // Send confirmation notifications
    if (paymentIntent.metadata.order_id) {
      await sendOrderConfirmationNotification(parseInt(paymentIntent.metadata.order_id));
    }
    
    console.log(`Payment intent succeeded: ${paymentIntent.id}`);
  } catch (error) {
    console.error('Error handling payment success:', error);
  }
}

/**
 * Handle failed payment intent
 */
async function handlePaymentIntentFailed(paymentIntent) {
  try {
    await stripeService.handlePaymentFailure(paymentIntent);
    
    // Send failure notifications
    if (paymentIntent.metadata.order_id) {
      await sendPaymentFailureNotification(parseInt(paymentIntent.metadata.order_id));
    }
    
    console.log(`Payment intent failed: ${paymentIntent.id}`);
  } catch (error) {
    console.error('Error handling payment failure:', error);
  }
}

/**
 * Handle canceled payment intent
 */
async function handlePaymentIntentCanceled(paymentIntent) {
  try {
    const orderId = parseInt(paymentIntent.metadata.order_id);
    
    await prisma.orders.update({
      where: { id: orderId },
      data: {
        status: 'cancelled',
        payment_status: 'cancelled',
        cancelled_at: new Date()
      }
    });

    await prisma.payments.update({
      where: { stripe_payment_intent_id: paymentIntent.id },
      data: { status: 'cancelled' }
    });

    // Add status history
    await prisma.order_status_history.create({
      data: {
        order_id: orderId,
        from_status: 'pending',
        to_status: 'cancelled',
        notes: 'Payment intent was canceled'
      }
    });

    console.log(`Payment intent canceled: ${paymentIntent.id}`);
  } catch (error) {
    console.error('Error handling payment cancellation:', error);
  }
}

/**
 * Handle successful invoice payment (subscriptions)
 */
async function handleInvoicePaymentSucceeded(invoice) {
  try {
    if (invoice.subscription) {
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      
      // Update subscription payment record
      await prisma.payments.upsert({
        where: { stripe_payment_intent_id: invoice.payment_intent },
        update: {
          status: 'succeeded',
          completed_at: new Date()
        },
        create: {
          user_id: parseInt(subscription.metadata.user_id),
          stripe_payment_intent_id: invoice.payment_intent,
          amount_cents: invoice.amount_paid,
          currency: 'CAD',
          payment_type: 'subscription_donation',
          status: 'succeeded',
          completed_at: new Date()
        }
      });

      // Send subscription confirmation notification
      await sendSubscriptionConfirmationNotification(parseInt(subscription.metadata.user_id));
    }

    console.log(`Invoice payment succeeded: ${invoice.id}`);
  } catch (error) {
    console.error('Error handling invoice payment success:', error);
  }
}

/**
 * Handle failed invoice payment (subscriptions)
 */
async function handleInvoicePaymentFailed(invoice) {
  try {
    if (invoice.subscription) {
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      
      // Update payment record
      await prisma.payments.update({
        where: { stripe_payment_intent_id: invoice.payment_intent },
        data: {
          status: 'failed',
          failure_reason: 'Invoice payment failed'
        }
      });

      // Send payment failure notification
      await sendSubscriptionFailureNotification(parseInt(subscription.metadata.user_id));
    }

    console.log(`Invoice payment failed: ${invoice.id}`);
  } catch (error) {
    console.error('Error handling invoice payment failure:', error);
  }
}

/**
 * Handle subscription creation
 */
async function handleSubscriptionCreated(subscription) {
  try {
    const userId = parseInt(subscription.metadata.user_id);
    
    // Update user subscription status if needed
    // This would depend on your user subscription model
    
    console.log(`Subscription created: ${subscription.id} for user ${userId}`);
  } catch (error) {
    console.error('Error handling subscription creation:', error);
  }
}

/**
 * Handle subscription update
 */
async function handleSubscriptionUpdated(subscription) {
  try {
    const userId = parseInt(subscription.metadata.user_id);
    
    // Handle subscription changes (upgrades, downgrades, etc.)
    
    console.log(`Subscription updated: ${subscription.id} for user ${userId}`);
  } catch (error) {
    console.error('Error handling subscription update:', error);
  }
}

/**
 * Handle subscription deletion/cancellation
 */
async function handleSubscriptionDeleted(subscription) {
  try {
    const userId = parseInt(subscription.metadata.user_id);
    
    // Handle subscription cancellation
    await sendSubscriptionCancellationNotification(userId);
    
    console.log(`Subscription deleted: ${subscription.id} for user ${userId}`);
  } catch (error) {
    console.error('Error handling subscription deletion:', error);
  }
}

/**
 * Handle charge dispute
 */
async function handleChargeDisputeCreated(dispute) {
  try {
    const charge = await stripe.charges.retrieve(dispute.charge);
    const paymentIntent = await stripe.paymentIntents.retrieve(charge.payment_intent);
    
    if (paymentIntent.metadata.order_id) {
      const orderId = parseInt(paymentIntent.metadata.order_id);
      
      // Update order with dispute status
      await prisma.orders.update({
        where: { id: orderId },
        data: {
          admin_notes: `Dispute created: ${dispute.reason}`,
          status: 'disputed'
        }
      });

      // Add status history
      await prisma.order_status_history.create({
        data: {
          order_id: orderId,
          to_status: 'disputed',
          notes: `Charge disputed: ${dispute.reason}`
        }
      });

      // Notify admin
      await sendDisputeNotificationToAdmin(orderId, dispute);
    }
    
    console.log(`Charge dispute created: ${dispute.id}`);
  } catch (error) {
    console.error('Error handling charge dispute:', error);
  }
}

/**
 * Send order confirmation notification
 */
async function sendOrderConfirmationNotification(orderId) {
  try {
    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      include: {
        user: {
          select: { id: true, username: true, email: true }
        },
        order_items: {
          include: {
            item: {
              select: { name: true, item_type: true }
            }
          }
        }
      }
    });

    if (!order) return;

    // Create notification for user
    await prisma.notifications.create({
      data: {
        user_id: order.user_id,
        type: 'payment_received',
        title: 'Order Confirmed!',
        message: `Your order ${order.order_number} has been confirmed and payment received.`,
        action_url: `/orders/${order.order_number}`,
        reference_type: 'order',
        reference_id: order.id
      }
    });

    console.log(`Order confirmation notification sent for order ${orderId}`);
  } catch (error) {
    console.error('Error sending order confirmation:', error);
  }
}

/**
 * Send payment failure notification
 */
async function sendPaymentFailureNotification(orderId) {
  try {
    const order = await prisma.orders.findUnique({
      where: { id: orderId },
      include: {
        user: {
          select: { id: true, username: true, email: true }
        }
      }
    });

    if (!order) return;

    await prisma.notifications.create({
      data: {
        user_id: order.user_id,
        type: 'payment_failed',
        title: 'Payment Failed',
        message: `Payment for order ${order.order_number} has failed. Please try again.`,
        action_url: `/orders/${order.order_number}`,
        reference_type: 'order',
        reference_id: order.id
      }
    });

    console.log(`Payment failure notification sent for order ${orderId}`);
  } catch (error) {
    console.error('Error sending payment failure notification:', error);
  }
}

/**
 * Send subscription confirmation notification
 */
async function sendSubscriptionConfirmationNotification(userId) {
  try {
    await prisma.notifications.create({
      data: {
        user_id: userId,
        type: 'payment_received',
        title: 'Subscription Payment Confirmed',
        message: 'Your subscription payment has been processed successfully.',
        action_url: '/account/subscriptions'
      }
    });

    console.log(`Subscription confirmation notification sent for user ${userId}`);
  } catch (error) {
    console.error('Error sending subscription confirmation:', error);
  }
}

/**
 * Send subscription failure notification
 */
async function sendSubscriptionFailureNotification(userId) {
  try {
    await prisma.notifications.create({
      data: {
        user_id: userId,
        type: 'payment_failed',
        title: 'Subscription Payment Failed',
        message: 'Your subscription payment has failed. Please update your payment method.',
        action_url: '/account/subscriptions'
      }
    });

    console.log(`Subscription failure notification sent for user ${userId}`);
  } catch (error) {
    console.error('Error sending subscription failure notification:', error);
  }
}

/**
 * Send subscription cancellation notification
 */
async function sendSubscriptionCancellationNotification(userId) {
  try {
    await prisma.notifications.create({
      data: {
        user_id: userId,
        type: 'admin_announcement',
        title: 'Subscription Cancelled',
        message: 'Your subscription has been cancelled. You can reactivate it anytime.',
        action_url: '/account/subscriptions'
      }
    });

    console.log(`Subscription cancellation notification sent for user ${userId}`);
  } catch (error) {
    console.error('Error sending subscription cancellation notification:', error);
  }
}

/**
 * Send dispute notification to admin
 */
async function sendDisputeNotificationToAdmin(orderId, dispute) {
  try {
    // Get all admin users
    const adminUsers = await prisma.users.findMany({
      where: {
        role: { in: ['admin', 'moderator'] }
      },
      select: { id: true }
    });

    // Create notification for each admin
    const notifications = adminUsers.map(admin => ({
      user_id: admin.id,
      type: 'admin_announcement',
      title: 'Charge Dispute Created',
      message: `Order #${orderId} has a charge dispute: ${dispute.reason}`,
      action_url: `/admin/orders/${orderId}`,
      reference_type: 'order',
      reference_id: orderId
    }));

    await prisma.notifications.createMany({
      data: notifications
    });

    console.log(`Dispute notification sent to ${adminUsers.length} admins`);
  } catch (error) {
    console.error('Error sending dispute notification to admin:', error);
  }
}

module.exports = router;