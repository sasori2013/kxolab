import Stripe from 'stripe'

// Use a dummy key during build/dev if missing, to prevent "Neither apiKey nor config.authenticator provided" error
const key = process.env.STRIPE_SECRET_KEY || "sk_test_dummy_build_key"

export const stripe = new Stripe(key, {
    typescript: true,
})
