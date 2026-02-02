import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { supabase } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

// This secret comes from your Stripe dashboard
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET

export async function POST(req: Request) {
    const body = await req.text()
    const headerStore = await headers()
    const sig = headerStore.get('stripe-signature') as string

    let event: Stripe.Event

    try {
        if (!endpointSecret) throw new Error('Webhook secret undefined')
        event = stripe.webhooks.constructEvent(body, sig, endpointSecret)
    } catch (err: any) {
        console.error(`Webhook signature verification failed.`, err.message)
        return NextResponse.json({ error: 'Webhook Error' }, { status: 400 })
    }

    try {
        console.log('Webhook event received:', event.type)
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session
                const userId = session.metadata?.supabase_user_id
                console.log('Checkout completed for user:', userId)

                if (userId) {
                    // Update profile to active status
                    const { error } = await supabase
                        .from('profiles')
                        .update({
                            subscription_status: 'active',
                            stripe_customer_id: session.customer as string
                        })
                        .eq('id', userId)

                    if (error) console.error('Supabase update failed:', error)
                    else console.log('Supabase profile updated to active')
                } else {
                    console.error('No user ID found in session metadata')
                }
                break
            }

            case 'customer.subscription.created':
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
                const subscription = event.data.object as Stripe.Subscription
                const customerId = subscription.customer as string
                const status = subscription.status
                console.log(`Subscription updated [${event.type}]: ${customerId} -> ${status}`)

                // subscription.status can be 'active', 'past_due', 'canceled', etc.
                await supabase
                    .from('profiles')
                    .update({ subscription_status: status })
                    .eq('stripe_customer_id', customerId)
                break
            }

            case 'invoice.payment_succeeded': {
                const invoice = event.data.object as Stripe.Invoice
                const customerId = invoice.customer as string
                const subscriptionId = (invoice as any).subscription as string
                console.log(`Invoice paid: ${customerId}`)

                // If invoice is paid, ensure subscription is active
                if (subscriptionId) {
                    await supabase
                        .from('profiles')
                        .update({ subscription_status: 'active' })
                        .eq('stripe_customer_id', customerId)
                }
                break
            }

            default:
                console.log(`Unhandled event type ${event.type}`)
        }
    } catch (error: any) {
        console.error('Webhook handler failed:', error)
        return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
    }

    return NextResponse.json({ received: true })
}
