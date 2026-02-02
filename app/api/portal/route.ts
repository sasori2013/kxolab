
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { stripe } from "@/lib/stripe"

export const runtime = 'nodejs'

export async function POST(req: Request) {
    try {
        const supabase = await createClient()
        const { data: { session } } = await supabase.auth.getSession()

        if (!session?.user) {
            return new NextResponse("Unauthorized", { status: 401 })
        }

        const { data: profile } = await supabase
            .from('profiles')
            .select('stripe_customer_id')
            .eq('id', session.user.id)
            .single()

        if (!profile?.stripe_customer_id) {
            return NextResponse.json({ error: "No billing information found" }, { status: 404 })
        }

        const stripeSession = await stripe.billingPortal.sessions.create({
            customer: profile.stripe_customer_id,
            return_url: `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/`,
        })

        return NextResponse.json({ url: stripeSession.url })
    } catch (error: any) {
        console.error("Portal error:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
