"use client"

import * as React from "react"
import { Eraser, Loader2, Pen, Type } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { reportClientError } from "@/lib/errors/client"

type Stroke = {
  type: "path" | "text"
  color: string
  width: number
  points?: { x: number; y: number }[]
  text?: string
  x?: number
  y?: number
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  file: File | null
  onSave: (file: File, annotationJson: string) => Promise<void>
}

export function PhotoAnnotatorDialog({ open, onOpenChange, file, onSave }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [imageUrl, setImageUrl] = React.useState<string | null>(null)
  const [strokes, setStrokes] = React.useState<Stroke[]>([])
  const [currentPath, setCurrentPath] = React.useState<{ x: number; y: number }[]>([])
  const [tool, setTool] = React.useState<"pen" | "text" | "eraser">("pen")
  const [textInput, setTextInput] = React.useState("")
  const [textPos, setTextPos] = React.useState<{ x: number; y: number } | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [imageSize, setImageSize] = React.useState({ width: 0, height: 0 })
  const drawing = React.useRef(false)

  React.useEffect(() => {
    if (!file) {
      setImageUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setImageUrl(url)
    setStrokes([])
    setCurrentPath([])
    return () => URL.revokeObjectURL(url)
  }, [file])

  React.useEffect(() => {
    if (!imageUrl || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const img = new Image()
    img.onload = () => {
      const maxW = Math.min(600, window.innerWidth - 48)
      const scale = maxW / img.width
      const w = img.width * scale
      const h = img.height * scale
      canvas.width = w
      canvas.height = h
      setImageSize({ width: w, height: h })
      redraw(ctx, img, strokes, currentPath)
    }
    img.src = imageUrl
  }, [imageUrl, strokes, currentPath])

  function redraw(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    allStrokes: Stroke[],
    path: { x: number; y: number }[]
  ) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height)

    for (const stroke of allStrokes) {
      if (stroke.type === "path" && stroke.points?.length) {
        ctx.strokeStyle = stroke.color
        ctx.lineWidth = stroke.width
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.beginPath()
        stroke.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        })
        ctx.stroke()
      }
      if (stroke.type === "text" && stroke.text) {
        ctx.fillStyle = stroke.color
        ctx.font = `bold ${stroke.width * 4}px sans-serif`
        ctx.fillText(stroke.text, stroke.x || 0, stroke.y || 0)
      }
    }

    if (path.length) {
      ctx.strokeStyle = "#ef4444"
      ctx.lineWidth = 3
      ctx.lineCap = "round"
      ctx.beginPath()
      path.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      })
      ctx.stroke()
    }
  }

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (tool === "text") {
      const pos = getPos(e)
      setTextPos(pos)
      return
    }
    if (tool === "eraser") {
      setStrokes([])
      setCurrentPath([])
      return
    }
    drawing.current = true
    setCurrentPath([getPos(e)])
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || tool !== "pen") return
    setCurrentPath((prev) => [...prev, getPos(e)])
  }

  function handlePointerUp() {
    if (!drawing.current || tool !== "pen") return
    drawing.current = false
    if (currentPath.length > 1) {
      setStrokes((prev) => [
        ...prev,
        { type: "path", color: "#ef4444", width: 3, points: currentPath },
      ])
    }
    setCurrentPath([])
  }

  function addText() {
    if (!textInput.trim() || !textPos) return
    setStrokes((prev) => [
      ...prev,
      {
        type: "text",
        color: "#ef4444",
        width: 5,
        text: textInput,
        x: textPos.x,
        y: textPos.y,
      },
    ])
    setTextInput("")
    setTextPos(null)
  }

  async function handleSave() {
    const canvas = canvasRef.current
    if (!canvas || !file) return
    setSaving(true)
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9)
      )
      if (!blob) throw new Error("Kunne ikke eksportere bilde")
      const annotatedFile = new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
        type: "image/jpeg",
      })
      await onSave(annotatedFile, JSON.stringify({ strokes, imageSize }))
      onOpenChange(false)
    } catch (err) {
      reportClientError(err, { context: { action: "Lagre annotert KS-bilde" } })
      toast.error(err instanceof Error ? err.message : "Kunne ikke lagre bilde")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Marker bilde</DialogTitle>
          <DialogDescription>Tegn, skriv eller forklar direkte på bildet.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={tool === "pen" ? "default" : "outline"}
            onClick={() => setTool("pen")}
          >
            <Pen className="mr-1 size-3.5" />
            Tegn
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tool === "text" ? "default" : "outline"}
            onClick={() => setTool("text")}
          >
            <Type className="mr-1 size-3.5" />
            Tekst
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tool === "eraser" ? "default" : "outline"}
            onClick={() => setTool("eraser")}
          >
            <Eraser className="mr-1 size-3.5" />
            Slett alt
          </Button>
        </div>

        {tool === "text" && textPos && (
          <div className="flex gap-2">
            <Input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Skriv tekst..."
              onKeyDown={(e) => e.key === "Enter" && addText()}
            />
            <Button type="button" size="sm" onClick={addText}>
              Legg til
            </Button>
          </div>
        )}

        <div className="overflow-hidden rounded-lg border bg-muted">
          {imageUrl ? (
            <canvas
              ref={canvasRef}
              className="mx-auto max-w-full touch-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            />
          ) : (
            <div className="flex h-48 items-center justify-center text-muted-foreground">
              Ingen bilde
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Avbryt
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={saving || !file}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Lagre bilde
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
