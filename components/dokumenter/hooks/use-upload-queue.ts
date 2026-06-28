"use client"

import { useCallback, useRef, useState } from "react"
import * as api from "../data/api"
import { cacheInsertItem, ensureFolder, ensureRootFolders, invalidateFolder } from "../data/documents-store"
import type { Provider, UploadTask } from "../types"

const MAX_CONCURRENT = 3
let taskCounter = 0

type Job = { task: UploadTask; file: File; provider: Provider; parentId: string | null }

export function useUploadQueue(provider: Provider, parentId: string | null, onSettled?: () => void) {
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const targetRef = useRef({ provider, parentId })
  targetRef.current = { provider, parentId }

  const queueRef = useRef<Job[]>([])
  const jobsRef = useRef<Map<string, Omit<Job, "task">>>(new Map())
  const activeRef = useRef(0)
  const settledRef = useRef(onSettled)
  settledRef.current = onSettled

  const updateTask = useCallback((id: string, patch: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const dismiss = useCallback((id: string) => {
    jobsRef.current.delete(id)
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const clearCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status !== "done"))
  }, [])

  const pump = useCallback(() => {
    while (activeRef.current < MAX_CONCURRENT && queueRef.current.length > 0) {
      const job = queueRef.current.shift()
      if (!job) break
      activeRef.current += 1
      updateTask(job.task.id, { status: "uploading", progress: 0 })

      const { promise } = api.uploadFile(job.provider, job.file, job.parentId, (pct) =>
        updateTask(job.task.id, { progress: pct })
      )

      promise
        .then((item) => {
          updateTask(job.task.id, { status: "done", progress: 100 })
          if (job.provider === "supabase" && item) {
            cacheInsertItem(job.provider, job.parentId, item)
          } else {
            invalidateFolder(job.provider, job.parentId)
            ensureFolder(job.provider, job.parentId, true)
          }
          ensureRootFolders(job.provider, true)
          // Auto-dismiss successful tasks shortly after.
          setTimeout(() => dismiss(job.task.id), 2500)
        })
        .catch((e: unknown) => {
          updateTask(job.task.id, { status: "error", error: (e as Error).message })
        })
        .finally(() => {
          activeRef.current -= 1
          settledRef.current?.()
          pump()
        })
    }
  }, [updateTask, dismiss])

  const enqueue = useCallback(
    (files: File[] | FileList | null) => {
      const list = files ? Array.from(files) : []
      if (list.length === 0) return
      const { provider: p, parentId: pid } = targetRef.current

      const newTasks: UploadTask[] = []
      for (const file of list) {
        const id = `up-${++taskCounter}`
        const task: UploadTask = {
          id,
          name: file.name,
          sizeBytes: file.size,
          progress: 0,
          status: "pending",
        }
        newTasks.push(task)
        jobsRef.current.set(id, { file, provider: p, parentId: pid })
        queueRef.current.push({ task, file, provider: p, parentId: pid })
      }
      setTasks((prev) => [...prev, ...newTasks])
      pump()
    },
    [pump]
  )

  const retry = useCallback(
    (id: string) => {
      const info = jobsRef.current.get(id)
      if (!info) return
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status: "pending", progress: 0, error: undefined } : t))
      )
      const task = { id, name: info.file.name, sizeBytes: info.file.size, progress: 0, status: "pending" as const }
      queueRef.current.push({ task, ...info })
      pump()
    },
    [pump]
  )

  const activeCount = tasks.filter((t) => t.status === "pending" || t.status === "uploading").length

  return { tasks, enqueue, retry, dismiss, clearCompleted, activeCount, isUploading: activeCount > 0 }
}

export type UploadQueueApi = ReturnType<typeof useUploadQueue>
