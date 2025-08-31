// src/services/stripeService.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class StripeService {
  constructor() {
    this.stripe = stripe;
  }

  async createOrGetCustomer(user) {
    try {
      const existingUser = await prisma.users.findUnique({
        where: { id: user.id },
        select: { stripe_customer_id: true }
      });

      if (existingUser?.stripe_customer_id) {
        try {
          const customer = await this.stripe.customers.retrieve(existingUser.stripe_customer_id);
          return customer;
        } catch (error) {
          console.log('Stripe customer not found, creating new one');
        }
      }

      const customer = await this.stripe.customers.create({
        email: user.email,
        name: user.username,
        metadata: {
          user_id: user.id.toString(),
          id_no: user.id_no
        }
      });

      await prisma.users.update({
        where: { id: user.id },
        data: { stripe_customer_id: customer.id }
      });

      return customer;
    } catch (error) {
      console.error('Error creating/getting Stripe customer:', error);
      throw new Error('Failed to create customer');
    }
  }

  async createPaymentIntent(order, user) {
    try {
      const customer = await this.createOrGetCustomer(user);

      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: order.total_cents,
        currency: 'cad',
        customer: customer.id,
        metadata: {
          order_id: order.id.toString(),
          order_number: order.order_number,
          user_id: user.id.toString()
        },
        description: `Order ${order.order_number}`,
        automatic_payment_methods: {
          enabled: true,
        }
      });

      await prisma.orders.update({
        where: { id: order.id },
        data: { 
          stripe_payment_intent_id: paymentIntent.id,
          stripe_customer_id: customer.id
        }
      });

      await prisma.payments.create({
        data: {
          user_id: user.id,
          stripe_payment_intent_id: paymentIntent.id,
          amount_cents: order.total_cents,
          currency: 'CAD',
          payment_type: 'store_purchase',
          status: 'pending',
          reference_id: order.id
        }
      });

      return paymentIntent;
    } catch (error) {
      console.error('Error creating payment intent:', error);
      throw new Error('Failed to create payment intent');
    }
  }

  async handlePaymentSuccess(paymentIntent) {
    try {
      const orderId = parseInt(paymentIntent.metadata.order_id);
      
      await prisma.orders.update({
        where: { id: orderId },
        data: {
          payment_status: 'succeeded',
          status: 'confirmed'
        }
      });

      await prisma.payments.update({
        where: { stripe_payment_intent_id: paymentIntent.id },
        data: {
          status: 'succeeded',
          completed_at: new Date()
        }
      });

      return true;
    } catch (error) {
      console.error('Error handling payment success:', error);
      throw error;
    }
  }

  async handlePaymentFailure(paymentIntent) {
    try {
      const orderId = parseInt(paymentIntent.metadata.order_id);
      
      await prisma.orders.update({
        where: { id: orderId },
        data: {
          payment_status: 'failed',
          status: 'cancelled'
        }
      });

      await prisma.payments.update({
        where: { stripe_payment_intent_id: paymentIntent.id },
        data: {
          status: 'failed',
          failure_reason: paymentIntent.last_payment_error?.message || 'Payment failed'
        }
      });

      return true;
    } catch (error) {
      console.error('Error handling payment failure:', error);
      throw error;
    }
  }
}

module.exports = new StripeService();
