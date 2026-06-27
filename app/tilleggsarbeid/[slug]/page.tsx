import { notFound } from "next/navigation"

import { fetchPublicChangeOrderBySlug } from "@/lib/tilleggsarbeid/change-order"
import { CustomerChangeOrderView } from "./customer-change-order-view"

export default async function ChangeOrderPublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const co = await fetchPublicChangeOrderBySlug(slug)
  if (!co) notFound()
  return <CustomerChangeOrderView co={co} slug={slug} />
}
