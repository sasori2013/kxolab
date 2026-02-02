"use client"

import { useState } from "react"
// @ts-ignore
import { loadStripe } from "@stripe/stripe-js"

export function UpgradeModal({
    isOpen,
    onClose,
    userId
}: {
    isOpen: boolean
    onClose: () => void
    userId?: string
}) {
    const [loading, setLoading] = useState(false)

    if (!isOpen) return null

    const handleUpgrade = async () => {
        setLoading(true)
        try {
            // Typically you'd get this from an env var or constant
            // For now we assume the API knows the default price, or we pass one if configured
            // We'll pass a placeholder or let the API pick the default
            const priceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_ID
            if (!priceId) {
                alert("Stripe Price ID is missing. Please check .env.local")
                setLoading(false)
                return
            }

            const res = await fetch("/api/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ priceId }),
            })
            const json = await res.json()
            if (json.sessionId) {
                // Redirect to Stripe
                const stripe = await loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)
                await (stripe as any)?.redirectToCheckout({ sessionId: json.sessionId })
            } else {
                alert("Failed to start checkout.")
            }
        } catch (e) {
            console.error(e)
            alert("Something went wrong.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-zinc-900 border border-zinc-700 rounded-2xl p-8 shadow-2xl relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-zinc-500 hover:text-white"
                >
                    ✕
                </button>

                <div className="text-center space-y-6">
                    <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto mb-4 ring-1 ring-indigo-500/40">
                        <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                    </div>

                    <h2 className="text-2xl font-bold text-white">Unlock Unlimited Generation</h2>
                    <p className="text-zinc-400 text-sm leading-relaxed">
                        Get professional AI photo enhancement without limits.
                        Subscribe now to process as many images as you need.
                    </p>

                    <div className="bg-zinc-950 rounded-xl p-4 border border-zinc-800">
                        <div className="flex items-baseline justify-center gap-1">
                            <span className="text-3xl font-bold text-white">$29</span>
                            <span className="text-zinc-500">/month</span>
                        </div>
                        <p className="text-zinc-600 text-xs mt-2">Cancel anytime.</p>
                    </div>

                    <button
                        onClick={handleUpgrade}
                        disabled={loading}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3.5 rounded-xl transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50"
                    >
                        {loading ? "Redirecting..." : "Upgrade Now"}
                    </button>
                </div>
            </div>
        </div>
    )
}
