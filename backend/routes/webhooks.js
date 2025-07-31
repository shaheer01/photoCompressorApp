const express = require('express');
const Stripe = require('stripe');
const { query, transaction } = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Middleware to verify Stripe webhook signature
const verifyStripeSignature = (req, res, next) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
        req.stripeEvent = event;
        next();
    } catch (err) {
        logger.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
};

// POST /api/webhooks/stripe - Handle Stripe webhooks
router.post('/stripe', express.raw({ type: 'application/json' }), verifyStripeSignature, async (req, res) => {
    const event = req.stripeEvent;
    
    logger.info(`Received Stripe webhook: ${event.type}`);

    try {
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutCompleted(event.data.object);
                break;
                
            case 'invoice.payment_succeeded':
                await handlePaymentSucceeded(event.data.object);
                break;
                
            case 'invoice.payment_failed':
                await handlePaymentFailed(event.data.object);
                break;
                
            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(event.data.object);
                break;
                
            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object);
                break;
                
            case 'customer.subscription.trial_will_end':
                await handleTrialWillEnd(event.data.object);
                break;
                
            default:
                logger.info(`Unhandled event type: ${event.type}`);
        }

        res.json({ received: true });
        
    } catch (error) {
        logger.error('Webhook processing error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// Handle successful checkout session
async function handleCheckoutCompleted(session) {
    logger.info(`Checkout completed: ${session.id}`);
    
    const userId = session.metadata.userId;
    const planId = session.metadata.planId;
    
    if (!userId) {
        logger.error('No userId in checkout session metadata');
        return;
    }

    try {
        // Get the subscription from Stripe
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        
        await transaction(async (client) => {
            // Update user subscription status
            const subscriptionEndDate = new Date(subscription.current_period_end * 1000);
            
            await client.query(
                `UPDATE users SET 
                    is_premium = true,
                    subscription_type = $1,
                    subscription_id = $2,
                    subscription_start_date = NOW(),
                    subscription_end_date = $3,
                    updated_at = NOW()
                 WHERE id = $4`,
                [planId, subscription.id, subscriptionEndDate, userId]
            );

            // Record the transaction
            await client.query(
                `INSERT INTO subscription_transactions 
                 (user_id, stripe_payment_intent_id, stripe_subscription_id, amount_cents, 
                  subscription_type, status, metadata)
                 VALUES ($1, $2, $3, $4, $5, 'succeeded', $6)`,
                [
                    userId,
                    session.payment_intent,
                    subscription.id,
                    session.amount_total,
                    planId,
                    JSON.stringify({ checkoutSessionId: session.id })
                ]
            );
        });

        logger.info(`User ${userId} upgraded to premium (${planId})`);
        
    } catch (error) {
        logger.error('Error processing checkout completion:', error);
        throw error;
    }
}

// Handle successful payment
async function handlePaymentSucceeded(invoice) {
    logger.info(`Payment succeeded: ${invoice.id}`);
    
    if (!invoice.subscription) {
        return; // Not a subscription payment
    }

    try {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const customer = await stripe.customers.retrieve(subscription.customer);
        
        // Find user by customer ID
        const userResult = await query(
            'SELECT id FROM users WHERE stripe_customer_id = $1',
            [customer.id]
        );

        if (userResult.rows.length === 0) {
            logger.error(`No user found for customer ${customer.id}`);
            return;
        }

        const userId = userResult.rows[0].id;
        
        await transaction(async (client) => {
            // Extend subscription
            const subscriptionEndDate = new Date(subscription.current_period_end * 1000);
            
            await client.query(
                `UPDATE users SET 
                    is_premium = true,
                    subscription_end_date = $1,
                    updated_at = NOW()
                 WHERE id = $2`,
                [subscriptionEndDate, userId]
            );

            // Record successful payment
            await client.query(
                `INSERT INTO subscription_transactions 
                 (user_id, stripe_payment_intent_id, stripe_subscription_id, stripe_invoice_id,
                  amount_cents, subscription_type, status, metadata)
                 VALUES ($1, $2, $3, $4, $5, 
                         (SELECT subscription_type FROM users WHERE id = $1), 
                         'succeeded', $6)`,
                [
                    userId,
                    invoice.payment_intent,
                    subscription.id,
                    invoice.id,
                    invoice.amount_paid,
                    JSON.stringify({ invoiceId: invoice.id })
                ]
            );
        });

        logger.info(`Subscription renewed for user ${userId}`);
        
    } catch (error) {
        logger.error('Error processing payment success:', error);
        throw error;
    }
}

// Handle failed payment
async function handlePaymentFailed(invoice) {
    logger.info(`Payment failed: ${invoice.id}`);
    
    if (!invoice.subscription) {
        return;
    }

    try {
        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        const customer = await stripe.customers.retrieve(subscription.customer);
        
        // Find user by customer ID
        const userResult = await query(
            'SELECT id, email, first_name FROM users WHERE stripe_customer_id = $1',
            [customer.id]
        );

        if (userResult.rows.length === 0) {
            logger.error(`No user found for customer ${customer.id}`);
            return;
        }

        const user = userResult.rows[0];
        
        // Record failed payment
        await query(
            `INSERT INTO subscription_transactions 
             (user_id, stripe_payment_intent_id, stripe_subscription_id, stripe_invoice_id,
              amount_cents, subscription_type, status, metadata)
             VALUES ($1, $2, $3, $4, $5, 
                     (SELECT subscription_type FROM users WHERE id = $1), 
                     'failed', $6)`,
            [
                user.id,
                invoice.payment_intent,
                subscription.id,
                invoice.id,
                invoice.amount_due,
                JSON.stringify({ 
                    invoiceId: invoice.id,
                    attemptCount: invoice.attempt_count 
                })
            ]
        );

        logger.warn(`Payment failed for user ${user.email} (attempt ${invoice.attempt_count})`);
        
        // TODO: Send email notification about failed payment
        
    } catch (error) {
        logger.error('Error processing payment failure:', error);
        throw error;
    }
}

// Handle subscription updates
async function handleSubscriptionUpdated(subscription) {
    logger.info(`Subscription updated: ${subscription.id}`);
    
    try {
        const customer = await stripe.customers.retrieve(subscription.customer);
        
        // Find user by customer ID
        const userResult = await query(
            'SELECT id FROM users WHERE stripe_customer_id = $1',
            [customer.id]
        );

        if (userResult.rows.length === 0) {
            logger.error(`No user found for customer ${customer.id}`);
            return;
        }

        const userId = userResult.rows[0].id;
        const subscriptionEndDate = new Date(subscription.current_period_end * 1000);
        
        // Update subscription details
        await query(
            `UPDATE users SET 
                subscription_end_date = $1,
                updated_at = NOW()
             WHERE id = $2`,
            [subscriptionEndDate, userId]
        );

        logger.info(`Subscription updated for user ${userId}`);
        
    } catch (error) {
        logger.error('Error processing subscription update:', error);
        throw error;
    }
}

// Handle subscription cancellation
async function handleSubscriptionDeleted(subscription) {
    logger.info(`Subscription cancelled: ${subscription.id}`);
    
    try {
        const customer = await stripe.customers.retrieve(subscription.customer);
        
        // Find user by customer ID
        const userResult = await query(
            'SELECT id, email FROM users WHERE stripe_customer_id = $1',
            [customer.id]
        );

        if (userResult.rows.length === 0) {
            logger.error(`No user found for customer ${customer.id}`);
            return;
        }

        const user = userResult.rows[0];
        
        // Downgrade user to free plan
        await query(
            `UPDATE users SET 
                is_premium = false,
                subscription_type = NULL,
                subscription_id = NULL,
                subscription_end_date = NULL,
                updated_at = NOW()
             WHERE id = $1`,
            [user.id]
        );

        logger.info(`User ${user.email} downgraded to free plan`);
        
        // TODO: Send email notification about cancellation
        
    } catch (error) {
        logger.error('Error processing subscription cancellation:', error);
        throw error;
    }
}

// Handle trial ending soon
async function handleTrialWillEnd(subscription) {
    logger.info(`Trial ending soon: ${subscription.id}`);
    
    try {
        const customer = await stripe.customers.retrieve(subscription.customer);
        
        // Find user by customer ID
        const userResult = await query(
            'SELECT id, email, first_name FROM users WHERE stripe_customer_id = $1',
            [customer.id]
        );

        if (userResult.rows.length === 0) {
            logger.error(`No user found for customer ${customer.id}`);
            return;
        }

        const user = userResult.rows[0];
        
        logger.info(`Trial ending soon for user ${user.email}`);
        
        // TODO: Send email notification about trial ending
        
    } catch (error) {
        logger.error('Error processing trial will end:', error);
        throw error;
    }
}

module.exports = router;