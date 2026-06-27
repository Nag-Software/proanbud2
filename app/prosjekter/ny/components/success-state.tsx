"use client"

import { CheckCircle2 } from "lucide-react"

import { Button } from "@/components/ui/button"

type SuccessStateProps = {
  projectName: string
  onGoToProject: () => void
  onCreateAnother: () => void
}

const particles = Array.from({ length: 18 }).map((_, index) => ({
  id: index,
  left: `${(index * 17) % 100}%`,
  delay: index * 0.04,
}))

export function SuccessState({ projectName, onGoToProject, onCreateAnother }: SuccessStateProps) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-accent/60 bg-accent/10 p-6 text-center sm:p-10">
      {/* Confetti via CSS keyframes instead of motion/react — same falling +
          fade effect with staggered delays, without bundling framer-motion. */}
      <style>{`@keyframes pa-confetti-fall{0%{transform:translateY(-12px);opacity:0}15%{opacity:1}85%{opacity:1}100%{transform:translateY(180px);opacity:0}}`}</style>
      {particles.map((particle) => (
        <span
          key={particle.id}
          className="absolute top-0 h-2 w-2 rounded-full bg-accent"
          style={{
            left: particle.left,
            animation: "pa-confetti-fall 2.6s linear infinite",
            animationDelay: `${particle.delay}s`,
          }}
        />
      ))}

      <div className="relative z-10 mx-auto w-full max-w-lg space-y-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">Prosjekt opprettet</h2>
        <p className="text-muted-foreground">
          <span className="font-semibold">{projectName || "Prosjektet"}</span> er klart. Du kan gå rett til prosjektet eller opprette et nytt.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button className="h-9 rounded-lg px-4" onClick={onGoToProject}>
            Gå til prosjekt
          </Button>
          <Button type="button" variant="outline" className="h-9 rounded-lg px-4" onClick={onCreateAnother}>
            Opprett et nytt
          </Button>
        </div>
      </div>
    </div>
  )
}
