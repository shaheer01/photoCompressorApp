const express = require('express');
const Stripe = require('stripe');
const { body, validationResult } = require('express-validator');
const { query, transaction } = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const logger = require('../utils/logger');

const router = express.Router();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// All routes require authentication
router.use(verifyToken);

// GET /api/subscriptions/plans - Get available subscription plans
router.get('/plans', async (req, res) => {
    try {
        // Get pricing from admin settings
        const settingsResult = await query(
            `SELECT setting_key, setting_value 
             FROM admin_settings 
             WHERE setting_key IN ('monthly_price_cents', 'yearly_price_cents', 'stripe_monthly_price_id', 'stripe_yearly_price_id')`
        );

        const settings = {};
        settingsResult.rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });

        const plans = [
            {
                id: 'monthly',
                name: 'Premium Monthly',
                price: parseInt(settings.monthly_price_cents || 999),
                currency: 'usd',
                interval: 'month',
                stripePriceId: settings.stripe_monthly_price_id,
                features: [
                    'Unlimited file uploads',
                    'No file size limits',
                    'Batch processing up to 100 files',
                    'Priority processing',
                    'Advanced compression algorithms',
                    'No advertisements',
                    'Email support'
                ]
            },
            {
                id: 'yearly',
                name: 'Premium Yearly',
                price: parseInt(settings.yearly_price_cents || 9999),
                currency: 'usd',
                interval: 'year',
                stripePriceId: settings.stripe_yearly_price_id,
                popular: true,
                savings: {
                    amount: (parseInt(settings.monthly_price_cents || 999) * 12) - parseInt(settings.yearly_price_cents || 9999),
                    percentage: Math.round(((parseInt(settings.monthly_price_cents || 999) * 12) - parseInt(settings.yearly_price_cents || 9999)) / (parseInt(settings.monthly_price_cents || 999) * 12) * 100)
                },
                features: [
                    'Everything in Monthly',
                    '2 months free',
                    'Priority support',
                    'API access',
                    'Advanced analytics'
                ]
            }
        ];

        res.json({
            plans,
            currency: 'USD'
        });

    } catch (error) {
        logger.error('Get plans error:', error);
        res.status(500).json({
            error: 'Failed to get plans',
            message: 'Internal server error'
        });
    }
});

// POST /api/subscriptions/create-checkout-session
router.post('/create-checkout-session', [
    body('planId').isIn(['monthly', 'yearly']).withMessage('Invalid plan ID'),
    body('successUrl').isURL().withMessage('Valid success URL is required'),
    body('cancelUrl').isURL().withMessage('Valid cancel URL is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { planId, successUrl, cancelUrl } = req.body;

        // Check if user already has an active subscription
        const existingSubscription = await query(
            'SELECT subscription_id FROM users WHERE id = $1 AND is_premium = true AND subscription_end_date > NOW()',
            [req.user.id]
        );

        if (existingSubscription.rows.length > 0) {
            return res.status(409).json({
                error: 'Already subscribed',
                message: 'You already have an active premium subscription'
            });
        }

        // Get price ID from settings
        const priceIdKey = planId === 'monthly' ? 'stripe_monthly_price_id' : 'stripe_yearly_price_id';
        const settingResult = await query(
            'SELECT setting_value FROM admin_settings WHERE setting_key = $1',
            [priceIdKey]
        );

        if (settingResult.rows.length === 0) {
            return res.status(500).json({
                error: 'Plan not configured',
                message: 'The selected plan is not properly configured'
            });
        }

        const priceId = settingResult.rows[0].setting_value;

        // Create or get Stripe customer
        let customerId = req.user.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: req.user.email,
                name: `${req.user.first_name} ${req.user.last_name}`,
                metadata: {
                    userId: req.user.id.toString()
                }
            });
            
            customerId = customer.id;
            
            // Update user with customer ID
            await query(
                'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
                [customerId, req.user.id]
            );
        }

        // Create checkout session
        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1
                }
            ],
            mode: 'subscription',
            success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: cancelUrl,
            metadata: {
                userId: req.user.id.toString(),
                planId: planId
            },
            subscription_data: {
                metadata: {
                    userId: req.user.id.toString(),
                    planId: planId
                }
            }
        });

        logger.info(`Checkout session created: ${session.id} for user ${req.user.email}`);

        res.json({
            sessionId: session.id,
            url: session.url
        });

    } catch (error) {
        logger.error('Create checkout session error:', error);
        res.status(500).json({
            error: 'Failed to create checkout session',
            message: 'Internal server error'
        });
    }
});

// POST /api/subscriptions/create-portal-session
router.post('/create-portal-session', [
    body('returnUrl').isURL().withMessage('Valid return URL is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { returnUrl } = req.body;

        if (!req.user.stripe_customer_id) {
            return res.status(400).json({
                error: 'No customer found',
                message: 'No Stripe customer associated with this account'
            });
        }

        // Create portal session
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: req.user.stripe_customer_id,
            return_url: returnUrl
        });

        res.json({
            url: portalSession.url
        });

    } catch (error) {
        logger.error('Create portal session error:', error);
        res.status(500).json({
            error: 'Failed to create portal session',
            message: 'Internal server error'
        });
    }
});

// GET /api/subscriptions/current - Get current subscription
router.get('/current', async (req, res) => {
    try {
        const userResult = await query(
            `SELECT 
                is_premium, subscription_type, subscription_id, 
                subscription_start_date, subscription_end_date, stripe_customer_id
             FROM users 
             WHERE id = $1`,
            [req.user.id]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }

        const user = userResult.rows[0];

        let subscription = {
            isPremium: user.is_premium,
            type: user.subscription_type,
            startDate: user.subscription_start_date,
            endDate: user.subscription_end_date,
            status: 'inactive'
        };

        // If user has a Stripe subscription, get details from Stripe
        if (user.subscription_id) {
            try {
                const stripeSubscription = await stripe.subscriptions.retrieve(user.subscription_id);
                
                subscription = {
                    ...subscription,
                    status: stripeSubscription.status,
                    currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
                    currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
                    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
                    cancelAt: stripeSubscription.cancel_at ? new Date(stripeSubscription.cancel_at * 1000) : null
                };
            } catch (stripeError) {
                logger.error('Error fetching Stripe subscription:', stripeError);
                // Continue with database info only
            }
        }

        res.json({ subscription });

    } catch (error) {
        logger.error('Get current subscription error:', error);
        res.status(500).json({
            error: 'Failed to get subscription',
            message: 'Internal server error'
        });
    }
});

// GET /api/subscriptions/usage-limits - Get usage limits based on subscription
router.get('/usage-limits', async (req, res) => {
    try {
        // Get limits from admin settings
        const settingsResult = await query(
            `SELECT setting_key, setting_value 
             FROM admin_settings 
             WHERE setting_key IN (
                'max_file_size_free_mb', 'max_file_size_premium_mb',
                'max_files_per_batch_free', 'max_files_per_batch_premium'
             )`
        );

        const settings = {};
        settingsResult.rows.forEach(row => {
            settings[row.setting_key] = parseInt(row.setting_value);
        });

        const isPremium = req.user.is_premium;

        const limits = {
            maxFileSizeMB: isPremium ? 
                (settings.max_file_size_premium_mb || 100) : 
                (settings.max_file_size_free_mb || 10),
            maxFilesPerBatch: isPremium ? 
                (settings.max_files_per_batch_premium || 50) : 
                (settings.max_files_per_batch_free || 5),
            hasAds: !isPremium,
            features: {
                unlimitedUploads: isPremium,
                priorityProcessing: isPremium,
                advancedAlgorithms: isPremium,
                apiAccess: isPremium,
                emailSupport: isPremium
            }
        };

        res.json({ limits });

    } catch (error) {
        logger.error('Get usage limits error:', error);
        res.status(500).json({
            error: 'Failed to get usage limits',
            message: 'Internal server error'
        });
    }
});

// GET /api/subscriptions/invoices - Get subscription invoices
router.get('/invoices', async (req, res) => {
    try {
        if (!req.user.stripe_customer_id) {
            return res.json({ invoices: [] });
        }

        const invoices = await stripe.invoices.list({
            customer: req.user.stripe_customer_id,
            limit: 20
        });

        const formattedInvoices = invoices.data.map(invoice => ({
            id: invoice.id,
            number: invoice.number,
            amount: invoice.amount_paid,
            currency: invoice.currency,
            status: invoice.status,
            created: new Date(invoice.created * 1000),
            periodStart: new Date(invoice.period_start * 1000),
            periodEnd: new Date(invoice.period_end * 1000),
            pdfUrl: invoice.invoice_pdf,
            hostedUrl: invoice.hosted_invoice_url
        }));

        res.json({ invoices: formattedInvoices });

    } catch (error) {
        logger.error('Get invoices error:', error);
        res.status(500).json({
            error: 'Failed to get invoices',
            message: 'Internal server error'
        });
    }
});

module.exports = router;