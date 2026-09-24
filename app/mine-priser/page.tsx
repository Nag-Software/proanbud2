import { redirect } from "next/navigation"

// «Mine priser» har ingen egen oversikt – timeprisene er inngangen.
export default function Page() {
  redirect("/mine-priser/timepriser")
}
