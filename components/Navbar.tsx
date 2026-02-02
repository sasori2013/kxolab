"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

export function Navbar() {
    const [user, setUser] = useState<any>(null)
    const [profile, setProfile] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const router = useRouter()

    useEffect(() => {
        const getSession = async () => {
            const { data: { session } } = await supabase.auth.getSession()
            setUser(session?.user ?? null)

            if (session?.user) {
                const { data: profileData } = await supabase
                    .from("profiles")
                    .select("*")
                    .eq("id", session.user.id)
                    .single()
                setProfile(profileData)
            }
            setLoading(false)
        }

        getSession()

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event: any, session: any) => {
            setUser(session?.user ?? null)
            if (session?.user) {
                const { data: profileData } = await supabase
                    .from("profiles")
                    .select("*")
                    .eq("id", session.user.id)
                    .single()
                setProfile(profileData)
            } else {
                setProfile(null)
            }
        })

        return () => subscription.unsubscribe()
    }, [])

    const handleLogout = async () => {
        await supabase.auth.signOut()
        router.refresh()
        router.push("/login")
    }

    return (
        <nav className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md">
            <div className="max-w-6xl mx-auto px-6 py-4">
                <div className="flex items-center justify-between">
                    <Link href="/" className="flex items-baseline gap-3 group">
                        <h1 className="text-xl font-bold tracking-tighter text-white group-hover:text-indigo-400 transition-colors">VIVE</h1>
                        <span className="text-[10px] text-zinc-500 font-light uppercase tracking-widest hidden sm:block">Professional AI Photo</span>
                    </Link>

                    <div className="flex items-center gap-6">
                        {!loading && (
                            <>
                                {user ? (
                                    <div className="flex items-center gap-4">
                                        <div className="flex flex-col items-end">
                                            <span className="text-xs font-medium text-white">{profile?.full_name || user.email}</span>
                                            <div className="flex items-center gap-2">
                                                {profile?.is_tester ? (
                                                    <span className="text-[10px] bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/20 font-medium">TESTER / UNLIMITED</span>
                                                ) : (
                                                    <span className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-medium uppercase tracking-tighter">
                                                        {profile?.subscription_status === "active" ? "Unlimited Plan" : "Free Plan"}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <button
                                            onClick={handleLogout}
                                            className="text-xs text-zinc-400 hover:text-white transition-colors"
                                        >
                                            Logout
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-4">
                                        <Link href="/login" className="text-xs text-zinc-400 hover:text-white transition-colors">Log in</Link>
                                        <Link
                                            href="/signup"
                                            className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg transition-all font-medium py-1.5 shadow-lg shadow-indigo-500/20"
                                        >
                                            Sign up
                                        </Link>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </nav>
    )
}
