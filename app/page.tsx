"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState, Suspense } from "react"
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider"
import { supabase } from "@/lib/supabase"
import { useSearchParams } from "next/navigation"

// Multi-slot implementation
type SlotStatus = "idle" | "queued" | "generating" | "done" | "error" | "retrying"
type PhotoStatus = "ready" | "uploading" | "uploaded" | "error" | "generating" | "done"

interface OutputSlot {
  id: string // Unique ID for key
  jobId?: string // Added for async jobs
  url: string | null
  status: SlotStatus
  error?: string
  updatedAt?: number
  currentStep?: string // Added for progress display
  isCoolingDown?: boolean
  retryCount?: number
}

interface UploadedPhoto {
  id: string
  file: File
  preview: string
  status: PhotoStatus

  // R2 upload 後に入る
  imageUrl: string | null
  uploadError?: string

  // History of results
  results: OutputSlot[]

  // Analysis Result
  category?: string
  subjectDescription?: string
  visualStrategy?: string
  brightness?: string
  people?: string
  tilt?: string
}

const MAX_UPLOADS = 4

function createSessionId() {
  const c = globalThis.crypto as Crypto | undefined
  const uuid = c?.randomUUID?.()
  if (uuid) return `sess_${uuid}`
  return `sess_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
}

function createPhotoId() {
  const c = globalThis.crypto as Crypto | undefined
  const uuid = c?.randomUUID?.()
  if (uuid) return `p_${uuid}`
  return `p_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
}

function createResultId() {
  return `r_${Math.random().toString(36).slice(2)}_${Date.now()}`
}

function StatusPill({
  photo,
  onInternalCheck
}: {
  photo: UploadedPhoto
  onInternalCheck: (p: UploadedPhoto) => void
}) {
  const [uploadLabel, setUploadLabel] = useState("Uploading…")

  useEffect(() => {
    if (photo.status !== "uploading") return

    // Toggle between Uploading and Analyzing
    const timer = setInterval(() => {
      setUploadLabel(prev => prev === "Uploading…" ? "Analyzing…" : "Uploading…")
    }, 2000)

    return () => clearInterval(timer)
  }, [photo.status])

  let label = ""
  let colorClass = "bg-neutral-800/90 text-white border border-white/20 backdrop-blur-md"

  const isHeic = photo.file.name.toLowerCase().endsWith(".heic") || photo.file.name.toLowerCase().endsWith(".heif")

  if (photo.status === "uploading") {
    if (isHeic) {
      label = "Converting…"
      colorClass = "bg-amber-500/90 text-white border border-white/30 backdrop-blur-md animate-pulse"
    } else {
      label = uploadLabel
      colorClass = "bg-neutral-900/90 text-white border border-white/30 backdrop-blur-md animate-pulse"
    }
  } else if (photo.status === "error") {
    label = "Error"
    colorClass = "bg-red-600/90 text-white border border-red-400 backdrop-blur-md"
  } else if (photo.status === "generating") {
    label = "Generating…"
    colorClass = "bg-blue-600/90 text-white border border-blue-400 backdrop-blur-md animate-pulse"
  } else if (photo.status === "uploaded") {
    label = "Ready" // Input state
    colorClass = "bg-neutral-800/90 text-white border border-white/20 backdrop-blur-md shadow-md"
  } else if (photo.status === "done") {
    label = "Done"
    colorClass = "bg-[#00e08a]/90 text-neutral-900 border border-[#00c97b] backdrop-blur-md shadow-lg font-bold"
  }

  if (!label) return null

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onInternalCheck(photo)
      }}
      className={`px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase rounded-full shadow-lg transition-transform active:scale-95 ${colorClass} ${photo.status === "generating" ? "cursor-pointer hover:opacity-90" : "cursor-default"}`}
    >
      {label}
    </button>
  )
}

// Sub-component for auto-scrolling result gallery
function ResultGallery({
  originalUrl,
  results,
  handleDownload,
  filename
}: {
  originalUrl: string | null,
  results: OutputSlot[],
  handleDownload: (url: string) => Promise<void>
  filename: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [currentIndex, setCurrentIndex] = useState(0)

  // Total slides = Original + Results
  const slides = useMemo(() => {
    const s: any[] = []
    if (originalUrl) s.push({ id: "original", url: originalUrl, label: "Before", type: "original", status: "done" as SlotStatus })
    results.forEach((r, i) => s.push({ ...r, label: `OUTPUT ${String(i + 1).padStart(2, '0')}`, type: "result" }))
    return s
  }, [originalUrl, results])

  useEffect(() => {
    if (scrollRef.current && results.length > 0) {
      // Newest is at the end. 
      const lastIdx = slides.length - 1
      scrollToIndex(lastIdx)
    }
  }, [results.length])

  const scrollToIndex = (index: number) => {
    if (scrollRef.current) {
      const container = scrollRef.current
      const target = container.children[index] as HTMLElement
      if (target) {
        container.scrollTo({
          left: target.offsetLeft,
          behavior: "smooth"
        })
      }
    }
    setCurrentIndex(index)
  }

  const handleScroll = () => {
    if (scrollRef.current) {
      const container = scrollRef.current
      const index = Math.round(container.scrollLeft / container.clientWidth)
      if (index !== currentIndex) setCurrentIndex(index)
    }
  }

  return (
    <div className="relative group">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex gap-4 overflow-x-auto pb-6 snap-x snap-mandatory scroll-smooth no-scrollbar"
      >
        {slides.map((res, idx) => {
          const isResult = res.type === "result"
          const canDownload = isResult && Boolean(res.url) && res.status === "done"
          const isLatest = isResult && idx === slides.length - 1

          return (
            <div key={res.id} className="snap-center shrink-0 w-full">
              <div className="relative rounded-2xl overflow-hidden border border-neutral-200 bg-white shadow-sm">
                {/* Labels Overlay */}
                <div className="absolute top-3 left-3 z-10">
                  <span className="px-2 py-1 text-[9px] font-medium tracking-widest text-white bg-black/50 backdrop-blur-md rounded uppercase">
                    {res.type === "original" ? (
                      <>ORIGINAL <span className="text-white/60 mx-1">|</span> {filename}</>
                    ) : (
                      res.label
                    )}
                  </span>
                </div>

                {/* Download Overlay */}
                {isResult && (
                  <button
                    onClick={() => res.url && handleDownload(res.url)}
                    disabled={!canDownload}
                    className="absolute bottom-3 right-3 z-10 w-10 h-10 bg-white/90 hover:bg-white text-neutral-900 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-95 disabled:opacity-0 pointer-events-auto"
                    title="Download"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                )}

                {res.url ? (
                  <img src={res.url} alt={res.label} className="w-full h-auto md:max-h-[70vh] min-h-[300px] object-contain bg-neutral-100" />
                ) : res.status === "generating" || res.status === "queued" || res.status === "retrying" ? (
                  <div className="h-80 md:h-[70vh] flex flex-col items-center justify-center text-sm text-neutral-400 animate-pulse bg-neutral-50 px-8 text-center italic">
                    <span className="tracking-widest uppercase text-[10px] mb-2 font-bold not-italic">
                      {res.isCoolingDown || res.status === 'retrying' ? "Wait to retry" : (res.status === "queued" ? "In Queue" : "Processing")}
                    </span>
                    {res.isCoolingDown || res.status === 'retrying' ? (
                      <span className="text-amber-500 text-[11px] font-medium leading-relaxed">
                        Vertex AI busy. Waiting to retry...<br />
                        <span className="text-[10px] opacity-70">(Attempt #{res.retryCount || 1})</span>
                      </span>
                    ) : res.currentStep ? (
                      <span className="text-neutral-500 text-[12px] capitalize">
                        {res.currentStep === "analyzing" && "Analyzing composition..."}
                        {res.currentStep === "generating" && "Generating enhancement..."}
                        {res.currentStep === "saving" && "Finalizing image..."}
                      </span>
                    ) : (
                      <span className="text-neutral-400 text-[12px]">Please wait a moment...</span>
                    )}
                  </div>
                ) : (
                  <div className="h-80 flex items-center justify-center text-sm text-red-400 bg-neutral-50">
                    Generation failed
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Navigation Arrows - Only on desktop/hover */}
      {slides.length > 1 && (
        <>
          <button
            onClick={() => scrollToIndex(Math.max(0, currentIndex - 1))}
            className="absolute left-[-20px] top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white border border-neutral-100 hidden md:flex items-center justify-center text-xl shadow-xl hover:bg-neutral-50 z-20 opacity-0 group-hover:opacity-100 transition-opacity"
            disabled={currentIndex === 0}
          >
            ‹
          </button>
          <button
            onClick={() => scrollToIndex(Math.min(slides.length - 1, currentIndex + 1))}
            className="absolute right-[-20px] top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white border border-neutral-100 hidden md:flex items-center justify-center text-xl shadow-xl hover:bg-neutral-50 z-20 opacity-0 group-hover:opacity-100 transition-opacity"
            disabled={currentIndex === slides.length - 1}
          >
            ›
          </button>
        </>
      )}

      {/* Pagination Dots */}
      {slides.length > 1 && (
        <div className="flex justify-center gap-2 pt-2">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => scrollToIndex(i)}
              className={`w-1.5 h-1.5 rounded-full transition-all ${i === currentIndex ? "bg-neutral-800 w-3" : "bg-neutral-200"
                }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SceneContent() {
  // Session
  const [sessionId, setSessionId] = useState<string>(() => createSessionId())
  const resetSession = () => setSessionId(createSessionId())

  const [photos, setPhotos] = useState<UploadedPhoto[]>([])
  const photosRef = useRef<UploadedPhoto[]>([])
  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  // Persistent History
  const [history, setHistory] = useState<OutputSlot[]>([])

  const [hasEnhancedOnce, setHasEnhancedOnce] = useState(false)
  useEffect(() => {
    if (photos.length === 0) setHasEnhancedOnce(false)
  }, [photos.length])

  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState("")
  const [progressText, setProgressText] = useState("")
  const [customPrompt, setCustomPrompt] = useState("")
  const [resolution, setResolution] = useState<"2K" | "4K">("2K")
  const [aspectRatio, setAspectRatio] = useState("original")


  // Auto-scroll to top when entering workspace mode (first upload)
  useEffect(() => {
    if (photos.length > 0 && !hasEnhancedOnce && !isGenerating) {
      window.scrollTo({ top: 0, behavior: "smooth" })
    }
  }, [photos.length, hasEnhancedOnce, isGenerating])

  // Hero (任意)
  const [showHello] = useState(true)

  const searchParams = useSearchParams()
  const heroSlides = useMemo(
    () => [
      { before: "/setup/top_before_1.jpg", after: "/setup/top_after_1.jpg" },
      { before: "/setup/top_before_2.jpg", after: "/setup/top_after_2.jpg" },
      { before: "/setup/top_before_3.jpg", after: "/setup/top_after_3.jpg" },
      { before: "/setup/top_before_4.jpg", after: "/setup/top_after_4.jpg" },
      { before: "/setup/top_before_5.jpg", after: "/setup/top_after_5.jpg" },
    ],
    [],
  )
  const [heroIndex, setHeroIndex] = useState(0)
  const [isInteracting, setIsInteracting] = useState(false)
  useEffect(() => {
    if (isInteracting) return
    const id = window.setInterval(() => {
      setHeroIndex((i) => (i + 1) % heroSlides.length)
    }, 5500)
    return () => window.clearInterval(id)
  }, [heroSlides.length, isInteracting])

  // Error banner
  const errorTimerRef = useRef<number | null>(null)
  const clearError = () => {
    if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current)
    errorTimerRef.current = null
    setError("")
  }
  const showError = (msg: string, delayMs = 50) => {
    if (errorTimerRef.current) window.clearTimeout(errorTimerRef.current)
    errorTimerRef.current = window.setTimeout(() => setError(msg), delayMs)
  }

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const anyUploading = useMemo(() => photos.some((p) => p.status === "uploading"), [photos])
  const anyReady = useMemo(
    () => photos.some((p) => (p.status === "uploaded" || p.status === "done") && !!p.imageUrl),
    [photos],
  )
  const allUploaded = useMemo(
    () => photos.length > 0 && photos.every((p) => (p.status === "uploaded" || p.status === "done" || p.status === "error") && !anyUploading),
    [photos],
  )

  // Fix: Check if any photo or result slot is currently generating
  const anyGenerating = useMemo(() => {
    return photos.some(p =>
      p.status === "generating" ||
      p.results.some(r => r.status === "generating")
    )
  }, [photos])

  const hasAnyResult = useMemo(() => {
    return photos.some(
      (p) => p.results.some(r => r.url && r.status === "done")
    )
  }, [photos])

  const pendingPhotosCount = useMemo(() => {
    return photos.filter(p => !!p.imageUrl && p.results.length === 0 && p.status !== "error").length
  }, [photos])

  const addResultSlot = (photoId: string) => {
    const newSlot: OutputSlot = { id: crypto.randomUUID().slice(0, 8), url: null, status: "idle" }
    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, results: [...p.results, newSlot] } : p))
    return newSlot.id
  }

  const updateResultSlot = (photoId: string, slotId: string, patch: Partial<OutputSlot>) => {
    setPhotos(prev => prev.map(p =>
      p.id === photoId
        ? { ...p, results: p.results.map(r => r.id === slotId ? { ...r, ...patch } : r) }
        : p
    ))
  }

  const updateSlotByJobId = (jobId: string, patch: Partial<OutputSlot>) => {
    setPhotos(prev => prev.map(p => {
      // Find if this photo owns the job
      const hasJob = p.results.some(r => r.jobId === jobId)
      if (!hasJob) return p

      const newResults = p.results.map(r => r.jobId === jobId ? { ...r, ...patch } : r)
      const anyGenerating = newResults.some(r => r.status === "generating")

      // Always mark as done if nothing is generating
      let newStatus = p.status
      if (!anyGenerating) {
        newStatus = "done"
      }

      return {
        ...p,
        results: newResults,
        status: newStatus
      }
    }))

    // Add to history if completed
    if (patch.status === "done" && patch.url) {
      console.log(`[UI History] Adding Job ${jobId} to production history.`, patch.url)
      setHistory(prev => {
        if (prev.some(h => h.jobId === jobId)) return prev
        const job = { ...patch, id: crypto.randomUUID().slice(0, 8), jobId, updatedAt: Date.now() } as OutputSlot
        return [job, ...prev]
      })
    } else if (patch.status === "error") {
      console.warn(`[UI Warning] Job ${jobId} failed:`, patch.error)
    }
  }

  // Polling check for job status (fallback for Realtime)
  const checkJobStatus = async (jobId: string) => {
    console.log("Starting job polling:", jobId)
    const MAX_SHALLOW_POLLS = 10
    const MAX_DEEP_POLLS = 300 // Expanded to ~15 minutes (90% of Imagen/Gemini wait times)
    let attempts = 0

    const poll = async () => {
      attempts++
      // Backoff strategy: 1s for first 10, then 3s
      const delay = attempts <= MAX_SHALLOW_POLLS ? 1000 : 3000

      await new Promise(resolve => setTimeout(resolve, delay))

      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', jobId)
        .single()

      if (error) {
        console.error("Error fetching job status:", error.message || error)
        if (error.code === "PGRST116" || error.code === "42501") {
          updateSlotByJobId(jobId, { status: "error", error: `Permission Denied: ${error.message}` })
          return
        }
        // If network error, keep trying.
        if (attempts > MAX_DEEP_POLLS) {
          updateSlotByJobId(jobId, { status: "error", error: "Connection lost" })
          return
        }
        return poll() // retry
      }

      if (data.status === 'completed' || data.status === 'failed' || data.status === 'retrying') {
        updateSlotByJobId(jobId, {
          url: data.result_url,
          status: data.status === 'completed' ? 'done' : (data.status === 'retrying' ? 'retrying' : 'error'),
          error: data.status === 'retrying' ? null : data.error,
          updatedAt: Date.now()
        })
        if (data.status !== 'retrying') {
          console.log("Job polling finished for:", jobId, "status:", data.status)
          return
        }
      }

      // Update current step & backoff
      const meta = data.execution_metadata || {}
      const steps = meta.steps || []
      const lastStep = steps[steps.length - 1]?.name
      updateSlotByJobId(jobId, {
        currentStep: lastStep,
        isCoolingDown: !!meta.is_cooling_down,
        retryCount: meta.qstash_retry || 0
      })

      if (attempts % 10 === 0) {
        console.log(`[Job Polling] Still waiting for Job ${jobId}... (Attempt ${attempts}/${MAX_DEEP_POLLS})`)
      }

      if (attempts < MAX_DEEP_POLLS) {
        return poll()
      } else {
        console.warn("Job polling timed out for:", jobId)
        updateSlotByJobId(jobId, { status: "error", error: "Timeout (15 min)" })
      }
    }

    poll()
  }


  // No auth checks needed


  useEffect(() => {
    const channel = supabase
      .channel('jobs-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'jobs' },
        (payload) => {
          const updatedJob = payload.new as any
          if (updatedJob.status === 'completed' || updatedJob.status === 'failed' || updatedJob.status === 'retrying') {
            updateSlotByJobId(updatedJob.id, {
              url: updatedJob.result_url,
              status: updatedJob.status === 'completed' ? 'done' : (updatedJob.status === 'retrying' ? 'retrying' : 'error'),
              error: updatedJob.status === 'retrying' ? null : updatedJob.error,
              updatedAt: Date.now()
            })
          } else {
            // Update current step & backoff
            const meta = updatedJob.execution_metadata || {}
            const steps = meta.steps || []
            const lastStep = steps[steps.length - 1]?.name
            updateSlotByJobId(updatedJob.id, {
              currentStep: lastStep,
              isCoolingDown: !!meta.is_cooling_down,
              retryCount: meta.qstash_retry || 0
            })
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const updatePhoto = (photoId: string, patch: Partial<UploadedPhoto>) => {
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, ...patch } : p)))
  }

  async function uploadToR2(args: { file: File; sessionId: string; photoId: string }) {
    let fileToUpload = args.file

    // 1. Client-side HEIC conversion
    const isHeic =
      args.file.name.toLowerCase().endsWith(".heic") ||
      args.file.name.toLowerCase().endsWith(".heif") ||
      args.file.type.includes("heic") ||
      args.file.type.includes("heif")

    if (isHeic) {
      try {
        console.log("Converting HEIC on client...", args.file.name)
        // Robust import handling for heic2any
        const heicModule = await import("heic2any")
        const heic2any = heicModule.default || (heicModule as any)

        const convertedBlob = await heic2any({
          blob: args.file,
          toType: "image/jpeg",
          quality: 0.9,
        })

        // Handle array vs single blob return
        const finalBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob
        fileToUpload = new File([finalBlob], args.file.name.replace(/\.[^/.]+$/, ".jpg"), {
          type: "image/jpeg"
        })
        console.log("Conversion success -> jpg", fileToUpload.size)
      } catch (e: any) {
        console.warn("HEIC conversion failed, falling back to original file upload.", e)
        // Fallback: use original file. 
        // Note: Preview will not work in browser, but R2 upload & Gemini generation will work.
        fileToUpload = args.file
      }
    }

    // 2. Get Presigned URL
    const resUrl = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: fileToUpload.name,
        contentType: fileToUpload.type,
        sessionId: args.sessionId,
        photoId: args.photoId,
        purpose: "input"
      })
    })

    const jsonUrl = await resUrl.json().catch(() => ({} as any))
    if (!resUrl.ok || !jsonUrl?.ok) {
      console.error("Presign failed", jsonUrl)
      throw new Error(jsonUrl?.error || `Upload preparation failed (${resUrl.status})`)
    }

    const { url, imageUrl, key } = jsonUrl

    // 3. Direct Upload to R2
    const uploadRes = await fetch(url, {
      method: "PUT",
      body: fileToUpload,
      headers: {
        "Content-Type": fileToUpload.type
      }
    })

    if (!uploadRes.ok) {
      console.error("R2 Direct Upload failed", uploadRes.status, uploadRes.statusText)
      throw new Error(`Upload failed (${uploadRes.status})`)
    }

    // 4. Analyze (skipped)
    let category: string | undefined
    let subjectDescription: string | undefined
    let visualStrategy: string | undefined
    let brightness: string | undefined
    let people: string | undefined
    let tilt: string | undefined

    try {
      // Analysis skipped as per user request
    } catch (e) {
      console.warn("Analysis skipped", e)
    }

    return { key: key as string | undefined, imageUrl: imageUrl as string, category, subjectDescription, visualStrategy, brightness, people, tilt }

  }


  const addFiles = async (files: File[]) => {
    // Determine image files (including HEIC)
    const imageFiles = files.filter((f) =>
      f.type.startsWith("image/") ||
      f.name.toLowerCase().endsWith(".heic") ||
      f.name.toLowerCase().endsWith(".heif")
    )

    if (photosRef.current.length >= MAX_UPLOADS) {
      showError(`You can upload up to ${MAX_UPLOADS} images.`)
      return
    }

    const availableSlots = MAX_UPLOADS - photosRef.current.length
    const filesToAdd = imageFiles.slice(0, availableSlots)

    if (filesToAdd.length === 0) {
      showError("Please select valid image files")
      return
    }

    clearError()

    // Process files (Direct upload, backend handles conversion)
    const processedFiles = filesToAdd

    processedFiles.forEach((file) => {
      const reader = new FileReader()
      reader.onloadend = async () => {
        const photoId = createPhotoId()
        const newPhoto: UploadedPhoto = {
          id: photoId,
          file,
          preview: reader.result as string,
          status: "uploading",
          imageUrl: null,
          results: [],
        }

        setPhotos((prev) => [newPhoto, ...prev])

        try {
          const { imageUrl, category, visualStrategy, brightness, people, tilt } = await uploadToR2({ file, sessionId, photoId })

          // Determine correct preview URL
          // If it was HEIC and we fell back to raw upload, use server-side thumbnail generation
          const isHeic = imageUrl.toLowerCase().endsWith(".heic") || imageUrl.toLowerCase().endsWith(".heif")
          const previewUrl = isHeic
            ? `/api/thumbnail?url=${encodeURIComponent(imageUrl)}`
            : imageUrl

          updatePhoto(photoId, {
            status: "uploaded",
            imageUrl,
            preview: previewUrl,
            category,
            visualStrategy,
            brightness,
            people,
            tilt,
            uploadError: undefined
          })
        } catch (e: any) {
          updatePhoto(photoId, {
            status: "error",
            imageUrl: null,
            uploadError: e?.message ?? "upload failed",
          })
          showError(e?.message ?? "Upload failed")
        }
      }
      reader.readAsDataURL(file)
    })
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ""
    addFiles(files)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    addFiles(files)
  }

  const handleDeletePhoto = (photoId: string) => {
    if (isGenerating || anyGenerating) return
    setPhotos((prev) => prev.filter((p) => p.id !== photoId))
    clearError()
  }

  const clearResultsAll = () => {
    if (isGenerating || anyGenerating) return
    setPhotos((prev) => prev.map((p) => ({ ...p, results: [] })))
    setHasEnhancedOnce(false)
    setProgressText("")
    clearError()
  }

  const clearAll = () => {
    if (isGenerating || anyGenerating) return
    setPhotos([])
    setHasEnhancedOnce(false)
    setProgressText("")
    clearError()
    resetSession()
  }

  const resetReferences = () => {
    if (isGenerating || anyGenerating) return
    setPhotos(prev => prev.slice(0, 1))
  }

  const [hideLatestResult, setHideLatestResult] = useState(false)
  const resetLatest = () => {
    setHideLatestResult(true)
  }

  // When a new generation starts, unhide
  useEffect(() => {
    if (isGenerating) setHideLatestResult(false)
  }, [isGenerating])

  // ✅ Download（R2 の public URL を直接 fetch すると CORS で死ぬ → /api/download 経由で落とす）
  const handleDownload = async (r2Url: string) => {
    const key = new URL(r2Url).pathname.replace(/^\/+/, "")
    const res = await fetch(`/api/download?key=${encodeURIComponent(key)}`)
    if (!res.ok) throw new Error("download failed")

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)

    const a = document.createElement("a")
    a.href = url
    a.download = key.split("/").pop() || "image.png"
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const downloadAll = async () => {
    for (const photo of photosRef.current) {
      for (const res of photo.results) {
        if (res.url && res.status === "done") {
          await handleDownload(res.url)
        }
      }
    }
  }

  // ✅ Generate 呼び出し（解析結果を添えて送る）
  async function callGenerate(
    imageUrl: string,
    category?: string,
    subjectDescription?: string,
    visualStrategy?: string,
    brightness?: string,
    people?: string,
    tilt?: string,
    photoId?: string,
    referenceImageUrls?: string[]
  ) {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        imageUrl,
        category,
        subjectDescription,
        visualStrategy,
        brightness,
        people,
        tilt,
        photoId,
        prompt: customPrompt,
        resolution,
        aspectRatio,
        referenceImageUrls,
        debug: true,
      }),

    })

    const json = await res.json().catch(() => ({} as any))

    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || `generate failed (${res.status})`)
    }
    return json as { ok: true; jobId: string; sessionId: string; error?: string }
  }


  // Specific Regenerate for one photo
  const handleRegenerate = async (photoId: string) => {
    const photo = photosRef.current.find(p => p.id === photoId)
    if (!photo || !photo.imageUrl) return
    if (isGenerating) return

    setIsGenerating(true)
    const resultId = addResultSlot(photoId)
    // Update parent status so the pill shows "Generating..."
    updatePhoto(photoId, { status: "generating" })
    updateResultSlot(photoId, resultId, { status: "generating" })

    try {
      const out = await callGenerate(
        photo.imageUrl,
        photo.category,
        photo.subjectDescription,
        photo.visualStrategy,
        photo.brightness,
        photo.people,
        photo.tilt,
        photoId,
        photosRef.current.slice(1).map(p => p.imageUrl).filter(Boolean) as string[]
      )
      if (out.ok && out.jobId) {
        updateResultSlot(photoId, resultId, { jobId: out.jobId, status: "generating" })
        checkJobStatus(out.jobId)
      } else {
        throw new Error(out.error || "Failed to start generation")
      }
    } catch (e: any) {
      updateResultSlot(photoId, resultId, { status: "error", error: e?.message })
      showError(e?.message)
    } finally {
      setIsGenerating(false)
    }
  }

  const generateForAll = async () => {
    clearError()

    const current = photosRef.current
    if (current.length === 0) return showError("Please upload at least one image")

    const mainPhoto = current[0]
    if (!mainPhoto.imageUrl) return showError("Main photo is still uploading. Please wait.")

    setHasEnhancedOnce(true)
    setIsGenerating(true)
    setProgressText("Initializing…")

    const resultId = addResultSlot(mainPhoto.id)
    updatePhoto(mainPhoto.id, { status: "generating" })
    updateResultSlot(mainPhoto.id, resultId, { status: "generating" })

    try {
      const out = await callGenerate(
        mainPhoto.imageUrl,
        mainPhoto.category,
        mainPhoto.subjectDescription,
        mainPhoto.visualStrategy,
        mainPhoto.brightness,
        mainPhoto.people,
        mainPhoto.tilt,
        mainPhoto.id,
        current.slice(1).map(p => p.imageUrl).filter(Boolean) as string[]
      )
      if (out.ok && out.jobId) {
        updateResultSlot(mainPhoto.id, resultId, { jobId: out.jobId, status: "generating" })
        checkJobStatus(out.jobId)
      } else {
        throw new Error(out.error || "Failed to start generation")
      }
    } catch (e: any) {
      updateResultSlot(mainPhoto.id, resultId, { status: "error", error: e?.message ?? "Generation failed" })
      updatePhoto(mainPhoto.id, { status: "error" })
      showError(e?.message ?? "Generation failed")
    } finally {
      setIsGenerating(false)
      setProgressText("")
    }
  }

  // Handle click on status pill (force check)
  const handleStatusClick = (p: UploadedPhoto) => {
    if (p.status === "generating") {
      // Force check all generating jobs for this photo
      const generatingSlots = p.results.filter(r => r.status === "generating" && r.jobId)
      generatingSlots.forEach(slot => checkJobStatus(slot.jobId!))
    }
  }

  const activePhoto = photos[0]
  const latestResult = !hideLatestResult ? (
    [...(activePhoto?.results || [])].reverse().find(r => r.status === "done" && r.url) ||
    [...(activePhoto?.results || [])].reverse().find(r => r.status === "generating" || r.status === "queued" || r.status === "retrying")
  ) : null

  const galleryResults = useMemo(() => {
    return history
  }, [history])

  return (
    <div className="min-h-screen bg-neutral-950 text-white selection:bg-[#00e08a]/30">

      <main className="max-w-7xl mx-auto px-4 md:px-8 py-8 md:py-16 space-y-12 md:space-y-24">

        {/* TOP SECTION: Comparison View */}
        <section className="animate-in fade-in slide-in-from-bottom-8 duration-1000">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-8 items-start">

            {/* INPUT SIDE */}
            <div className="relative group aspect-[4/3] sm:aspect-video lg:aspect-square bg-neutral-900 rounded-3xl overflow-hidden border border-white/5 shadow-2xl">
              {activePhoto ? (
                <>
                  <img
                    src={activePhoto.preview}
                    alt="Original"
                    className="w-full h-full object-contain p-2"
                  />
                  <div className="absolute top-4 left-4">
                    <span className="px-3 py-1.5 text-[10px] font-bold tracking-[0.2em] bg-black/60 backdrop-blur-xl border border-white/10 rounded-full uppercase">Input</span>
                  </div>
                  <button
                    onClick={() => handleDeletePhoto(activePhoto.id)}
                    className="absolute top-4 right-4 w-10 h-10 bg-white/10 hover:bg-white/20 backdrop-blur-xl rounded-full flex items-center justify-center text-white border border-white/20 transition-all active:scale-90 group-hover:opacity-100 md:opacity-0"
                  >
                    ×
                  </button>
                </>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  className="w-full h-full flex flex-col items-center justify-center gap-4 hover:bg-white/[0.02] transition-colors group"
                >
                  <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center border border-white/10 group-hover:scale-110 transition-transform">
                    <span className="text-3xl font-light text-neutral-400">+</span>
                  </div>
                  <div>
                    <p className="text-sm font-light tracking-widest text-neutral-400 uppercase">Upload Interior Photo</p>
                    <p className="text-[10px] text-neutral-600 mt-2 uppercase tracking-tighter">JPEG, PNG, HEIC up to 20MB</p>
                  </div>
                </button>
              )}
            </div>

            {/* OUTPUT SIDE */}
            <div className="relative aspect-[4/3] sm:aspect-video lg:aspect-square bg-neutral-900 rounded-3xl overflow-hidden border border-white/5 shadow-2xl flex items-center justify-center">
              {latestResult?.url ? (
                <>
                  <img
                    src={latestResult.url}
                    alt="Latest Output"
                    className="w-full h-full object-contain p-2 animate-in zoom-in-95 duration-700"
                  />
                  <div className="absolute top-4 left-4 flex gap-2">
                    <span className="px-3 py-1.5 text-[10px] font-bold tracking-[0.2em] bg-[#00e08a]/20 text-[#00e08a] backdrop-blur-xl border border-[#00e08a]/20 rounded-full uppercase">Output</span>
                    {!isGenerating && !anyGenerating && (
                      <button
                        onClick={resetLatest}
                        className="px-3 py-1.5 text-[10px] font-bold tracking-[0.2em] bg-black/40 hover:bg-black/60 text-neutral-400 hover:text-white backdrop-blur-xl border border-white/10 rounded-full uppercase transition-all active:scale-95"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => handleDownload(latestResult.url!)}
                    className="absolute bottom-4 right-4 w-12 h-12 bg-white/10 hover:bg-white text-neutral-900 rounded-full flex items-center justify-center shadow-xl transition-all active:scale-95 group-hover:opacity-100"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                </>
              ) : isGenerating || anyGenerating ? (
                <div className="flex flex-col items-center gap-6 text-center px-12 animate-pulse">
                  <div className="w-12 h-12 border-2 border-[#00e08a]/30 border-t-[#00e08a] rounded-full animate-spin" />
                  <div className="space-y-2">
                    <p className="text-xs font-bold tracking-[0.3em] uppercase text-[#00e08a]">Generating</p>
                    <p className="text-[11px] text-neutral-500 font-light italic">
                      {latestResult?.currentStep === "analyzing" && "Analyzing geometry..."}
                      {latestResult?.currentStep === "generating" && "Synthesizing enhancement..."}
                      {latestResult?.currentStep === "saving" && "Developing final image..."}
                      {!latestResult?.currentStep && "Initializing AI..."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center space-y-2 opacity-20">
                  <p className="text-[10px] font-bold tracking-[0.4em] uppercase">Result Pending</p>
                </div>
              )}
            </div>

          </div>

          {/* REFERENCE INSPIRATION SHELF */}
          <div className="mt-8 md:mt-12 space-y-6 pt-8 border-t border-white/5">
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-6 mb-2">
              <div className="text-center space-y-1">
                <label className="block text-[10px] font-bold tracking-[0.4em] text-neutral-600 uppercase">Reference Inspiration</label>
                <p className="text-[9px] text-neutral-700 font-light tracking-widest uppercase">Stylistic & Structural Guidance</p>
              </div>
              {photos.length > 1 && !isGenerating && !anyGenerating && (
                <button
                  onClick={resetReferences}
                  className="px-3 py-1 text-[9px] font-bold tracking-[0.2em] text-neutral-500 hover:text-neutral-300 border border-white/5 hover:border-white/10 rounded-full uppercase transition-all bg-white/[0.02]"
                >
                  Reset Refs
                </button>
              )}
            </div>

            <div className="flex flex-wrap justify-center gap-4">
              {photos.slice(1).map((photo) => (
                <div key={photo.id} className="relative w-24 h-24 sm:w-32 sm:h-32 bg-neutral-900 rounded-2xl overflow-hidden border border-white/5 shadow-xl group animate-in zoom-in-95 duration-500">
                  <img src={photo.preview} alt="Reference" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                  <button
                    onClick={() => handleDeletePhoto(photo.id)}
                    className="absolute top-2 right-2 w-7 h-7 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center text-white border border-white/10 opacity-0 group-hover:opacity-100 transition-all active:scale-95"
                    aria-label="Remove reference"
                  >
                    ×
                  </button>
                </div>
              ))}

              {photos.length > 0 && photos.length < MAX_UPLOADS && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-24 h-24 sm:w-32 sm:h-32 rounded-2xl border border-dashed border-white/10 flex flex-col items-center justify-center bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20 transition-all gap-2 group"
                >
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center border border-white/5 group-hover:scale-110 transition-transform">
                    <span className="text-lg font-light text-neutral-500">+</span>
                  </div>
                  <span className="text-[8px] text-neutral-500 font-bold uppercase tracking-[0.2em]">Add Ref</span>
                </button>
              )}
            </div>
          </div>

          {/* CONTROLS OVERLAY (CENTRALIZED) */}
          <div className="mt-8 md:mt-12 max-w-4xl mx-auto space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end">
              <div className="md:col-span-12">
                <label className="block text-[10px] font-bold tracking-[0.2em] text-neutral-500 uppercase mb-3 px-1">Concept Prompt</label>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="e.g. Minimalist japandi bedroom with natural oak wood, warm ambient lighting, and neutral linen textures..."
                  className="w-full h-24 p-5 text-sm font-light bg-neutral-900/50 border border-white/5 rounded-2xl focus:outline-none focus:border-[#00e08a]/40 focus:ring-1 focus:ring-[#00e08a]/20 transition-all resize-none shadow-inner"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-8 items-center">
              <div className="sm:col-span-4 space-y-3">
                <label className="block text-[10px] font-bold tracking-[0.2em] text-neutral-500 uppercase px-1">Format</label>
                <div className="flex bg-neutral-900/50 p-1 rounded-xl border border-white/5">
                  {["2K", "4K"].map((r) => (
                    <button
                      key={r}
                      onClick={() => setResolution(r as any)}
                      className={`flex-1 py-1.5 text-[10px] font-bold tracking-widest rounded-lg transition-all ${resolution === r ? "bg-white/10 text-[#00e08a]" : "text-neutral-500 hover:text-neutral-300"}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sm:col-span-8 space-y-3">
                <label className="block text-[10px] font-bold tracking-[0.2em] text-neutral-500 uppercase px-1">Ratio</label>
                <div className="flex flex-wrap gap-1 bg-neutral-900/50 p-1 rounded-xl border border-white/5">
                  {["original", "1:1", "3:4", "4:3", "16:9"].map((r) => (
                    <button
                      key={r}
                      onClick={() => setAspectRatio(r)}
                      className={`flex-1 min-w-[60px] py-1.5 text-[9px] font-bold tracking-widest rounded-lg transition-all uppercase ${aspectRatio === r ? "bg-white/10 text-[#00e08a]" : "text-neutral-500 hover:text-neutral-300"}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-4">
              <button
                onClick={generateForAll}
                disabled={isGenerating || anyGenerating || anyUploading || !activePhoto?.imageUrl}
                className="w-full h-20 text-[11px] font-bold tracking-[0.4em] bg-[#00e08a] text-neutral-950 hover:bg-[#00f79b] disabled:opacity-20 disabled:grayscale transition-all rounded-2xl shadow-[0_0_40px_rgba(0,224,138,0.15)] active:scale-[0.98] uppercase group"
              >
                {isGenerating || anyGenerating ? (
                  <span className="flex items-center justify-center gap-3">
                    <span className="w-1.5 h-1.5 bg-black rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1.5 h-1.5 bg-black rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1.5 h-1.5 bg-black rounded-full animate-bounce" />
                  </span>
                ) : (
                  "Initiate Enhancement"
                )}
              </button>

              {error && (
                <p className="mt-4 text-center text-[10px] text-red-500/80 font-medium tracking-widest uppercase animate-in fade-in slide-in-from-top-1">
                  {error}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* BOTTOM SECTION: Full-Ratio Gallery */}
        {galleryResults.length > 0 && (
          <section className="space-y-12 animate-in fade-in duration-1000">
            <div className="flex items-center justify-between border-b border-white/5 pb-6">
              <h2 className="text-[12px] font-bold tracking-[0.5em] text-neutral-500 uppercase">Production History</h2>
              <p className="text-[10px] text-neutral-600 font-light italic">{galleryResults.length} Generative Iterations</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-12">
              {galleryResults.map((res, i) => (
                <div key={res.id} className="group flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700" style={{ animationDelay: `${i * 100}ms` }}>
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-neutral-800">#{galleryResults.length - i}</span>
                      <span className="text-[8px] font-bold text-neutral-600 uppercase tracking-widest">
                        {res.updatedAt ? new Date(res.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'}
                      </span>
                    </div>
                    <button
                      onClick={() => res.url && handleDownload(res.url)}
                      className="w-7 h-7 bg-white/5 hover:bg-white/10 rounded-full flex items-center justify-center transition-all active:scale-90"
                      title="Download"
                    >
                      <svg className="w-3.5 h-3.5 text-neutral-400 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                  </div>

                  <div className="relative aspect-square sm:aspect-auto sm:min-h-[240px] rounded-2xl overflow-hidden border border-white/5 bg-neutral-900/50 shadow-xl transition-all group-hover:border-[#00e08a]/20 group-hover:shadow-[#00e08a]/5">
                    <img
                      src={res.url!}
                      alt={`Result ${i}`}
                      className="w-full h-full object-contain p-2 transition-transform duration-700 group-hover:scale-[1.02]"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Hidden Inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          onChange={handleFileChange}
          className="hidden"
        />
      </main>

      <footer className="max-w-7xl mx-auto px-8 py-20 mt-24 border-t border-white/5">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="text-[10px] font-bold tracking-[0.5em] text-neutral-600 uppercase">kxolab.ai</div>
          <p className="text-[10px] text-neutral-700 font-light tracking-widest uppercase text-center md:text-right">
            Advanced Generative Architectural Synthesis © 2026
          </p>
        </div>

        {/* Discrete Debug View (only visible if you know where to look or via URL) */}
        {typeof window !== 'undefined' && window.location.search.includes('debug=true') && (
          <div className="mt-8 p-4 bg-neutral-900/50 rounded-xl text-[8px] font-mono text-neutral-500 overflow-auto max-h-60 border border-white/5">
            <p className="font-bold mb-2">DEBUG STATE:</p>
            <p>Photos: {photos.length}</p>
            <pre>{JSON.stringify(photos.map(p => ({ id: p.id, status: p.status, results: p.results.length })), null, 2)}</pre>
            <p className="mt-2">History: {history.length}</p>
            <pre>{JSON.stringify(history.map(h => ({ jobId: h.jobId, url: !!h.url, status: h.status })), null, 2)}</pre>
          </div>
        )}
      </footer>
    </div>
  )
}

export default function ScenePage() {
  console.log(">>> [SERVER] RENDERING SCENE PAGE - LATEST VERSION <<<")
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <SceneContent />
    </Suspense>
  )
}
