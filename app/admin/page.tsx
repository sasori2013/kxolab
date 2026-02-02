"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"

export default function AdminPage() {
    const [jobs, setJobs] = useState<any[]>([])
    const [profiles, setProfiles] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const fetchData = async () => {
            // Fetch Jobs
            const { data: jobsData } = await supabase
                .from('jobs')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50)

            if (jobsData) setJobs(jobsData)

            // Fetch Profiles
            const { data: profilesData } = await supabase
                .from('profiles')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(20)

            if (profilesData) setProfiles(profilesData)
            setLoading(false)
        }

        fetchData()

        // Realtime subscription for log updates
        const channel = supabase
            .channel('admin-logs')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'jobs' },
                (payload) => {
                    setJobs(prev => {
                        const updated = [payload.new as any, ...prev].filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i)
                        return updated.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 50)
                    })
                }
            )
            .subscribe()

        return () => {
            supabase.removeChannel(channel)
        }
    }, [])

    if (loading) return <div className="p-10">Loading Admin...</div>

    return (
        <div className="min-h-screen bg-neutral-50 p-6 md:p-12">
            <div className="max-w-6xl mx-auto space-y-12">

                <header className="flex justify-between items-center">
                    <h1 className="text-3xl font-bold text-neutral-900">Admin Dashboard</h1>
                    <a href="/" className="text-sm underline">Back to App</a>
                </header>

                {/* Users Section */}
                <section className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm space-y-4">
                    <h2 className="text-xl font-semibold">Latest Users</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs md:text-sm">
                            <thead className="border-b">
                                <tr>
                                    <th className="py-2">Email</th>
                                    <th className="py-2">Status</th>
                                    <th className="py-2">Joined</th>
                                    <th className="py-2">ID</th>
                                </tr>
                            </thead>
                            <tbody>
                                {profiles.map(p => (
                                    <tr key={p.id} className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50">
                                        <td className="py-2 font-medium">{p.email}</td>
                                        <td className="py-2">
                                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wide ${p.subscription_status === 'active' ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-neutral-500'
                                                }`}>
                                                {p.subscription_status}
                                            </span>
                                        </td>
                                        <td className="py-2 text-neutral-500">{new Date(p.created_at).toLocaleString()}</td>
                                        <td className="py-2 text-neutral-400 font-mono text-[10px]">{p.id}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Jobs / Logs Section */}
                <section className="bg-white p-6 rounded-xl border border-neutral-200 shadow-sm space-y-4">
                    <h2 className="text-xl font-semibold">Generation Logs (Jobs)</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs md:text-sm">
                            <thead className="border-b">
                                <tr>
                                    <th className="py-2">Status</th>
                                    <th className="py-2">Time</th>
                                    <th className="py-2">Category</th>
                                    <th className="py-2">Prompt (Snippet)</th>
                                    <th className="py-2">Error</th>
                                </tr>
                            </thead>
                            <tbody>
                                {jobs.map(j => (
                                    <tr key={j.id} className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50">
                                        <td className="py-2">
                                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wide ${j.status === 'completed' ? 'bg-green-100 text-green-700' :
                                                    j.status === 'failed' ? 'bg-red-100 text-red-700' :
                                                        j.status === 'processing' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'
                                                }`}>
                                                {j.status}
                                            </span>
                                        </td>
                                        <td className="py-2 text-neutral-500">{new Date(j.created_at).toLocaleString()}</td>
                                        <td className="py-2">{j.category}</td>
                                        <td className="py-2 text-neutral-600 max-w-[200px] truncate" title={j.prompt}>
                                            {j.prompt}
                                        </td>
                                        <td className="py-2 text-red-500">{j.error}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

            </div>
        </div>
    )
}
