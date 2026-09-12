import { fetchSegmentStats } from "@/lib/selger/segmenter"
import { SegmenterClient } from "./segmenter-client"

export const dynamic = "force-dynamic"

export default async function SelgerSegmenterPage() {
  const segments = await fetchSegmentStats()
  return <SegmenterClient segments={segments} />
}
