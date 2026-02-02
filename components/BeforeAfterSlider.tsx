"use client"

import React, { useState, useRef, useEffect, useCallback } from "react"

interface BeforeAfterSliderProps {
    beforeImage: string
    afterImage: string
    className?: string
    onInteractionStart?: () => void
    onInteractionEnd?: () => void
}

export function BeforeAfterSlider({ beforeImage, afterImage, className = "", onInteractionStart, onInteractionEnd }: BeforeAfterSliderProps) {
    const [sliderPosition, setSliderPosition] = useState(50)
    const [isDragging, setIsDragging] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    const handleMove = useCallback(
        (clientX: number) => {
            if (!containerRef.current) return
            const rect = containerRef.current.getBoundingClientRect()
            const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
            const percent = Math.max(0, Math.min((x / rect.width) * 100, 100))
            setSliderPosition(percent)
        },
        []
    )

    const onMouseDown = useCallback(
        (e: React.MouseEvent | React.TouchEvent) => {
            setIsDragging(true)
            onInteractionStart?.()
            // Allow immediate jump on click
            const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
            handleMove(clientX)
        },
        [handleMove, onInteractionStart]
    )

    const onMouseUp = useCallback(() => {
        setIsDragging(false)
        onInteractionEnd?.()
    }, [onInteractionEnd])

    const onMouseMove = useCallback(
        (e: MouseEvent | TouchEvent) => {
            if (!isDragging) return
            const clientX = "touches" in e ? e.touches[0].clientX : e.clientX
            handleMove(clientX)
        },
        [isDragging, handleMove]
    )

    useEffect(() => {
        if (isDragging) {
            window.addEventListener("mousemove", onMouseMove)
            window.addEventListener("mouseup", onMouseUp)
            window.addEventListener("touchmove", onMouseMove)
            window.addEventListener("touchend", onMouseUp)
        } else {
            window.removeEventListener("mousemove", onMouseMove)
            window.removeEventListener("mouseup", onMouseUp)
            window.removeEventListener("touchmove", onMouseMove)
            window.removeEventListener("touchend", onMouseUp)
        }
        return () => {
            window.removeEventListener("mousemove", onMouseMove)
            window.removeEventListener("mouseup", onMouseUp)
            window.removeEventListener("touchmove", onMouseMove)
            window.removeEventListener("touchend", onMouseUp)
        }
    }, [isDragging, onMouseMove, onMouseUp])

    return (
        <div
            ref={containerRef}
            className={`relative w-full overflow-hidden select-none group cursor-ew-resize bg-neutral-100 ${className}`}
            onMouseDown={onMouseDown}
            onTouchStart={onMouseDown}
        >
            {/* After Image (Background) - Sets the height */}
            <img
                src={afterImage}
                alt="After"
                className="w-full h-auto block select-none pointer-events-none"
                draggable={false}
            />

            {/* Before Image (Foreground, clipped) */}
            <div
                className="absolute top-0 left-0 h-full w-full select-none pointer-events-none"
                style={{
                    clipPath: `inset(0 ${100 - sliderPosition}% 0 0)`, // Show left part based on slider
                }}
            >
                <img
                    src={beforeImage}
                    alt="Before"
                    className="w-full h-full object-cover block select-none"
                    draggable={false}
                />

                {/* Label for Before (Optional) */}
                <div className="absolute top-4 left-4 bg-black/50 text-white text-[10px] px-2 py-1 rounded font-light tracking-wide backdrop-blur-sm">
                    BEFORE
                </div>
            </div>

            {/* Label for After (Optional - positioned right) */}
            <div className="absolute top-4 right-4 bg-black/50 text-white text-[10px] px-2 py-1 rounded font-light tracking-wide backdrop-blur-sm pointer-events-none">
                AFTER
            </div>

            {/* Slider Handle */}
            <div
                className="absolute top-0 bottom-0 w-0.5 bg-white cursor-ew-resize"
                style={{ left: `${sliderPosition}%` }}
            >
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4 text-neutral-600">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-4 h-4 text-neutral-600 -ml-1">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                </div>
            </div>
        </div>
    )
}
