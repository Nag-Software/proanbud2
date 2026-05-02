import { redirect } from "next/navigation"

export default function NyttTilbudPage() {
  redirect("/tilbud?nyttTilbud=1")
}
