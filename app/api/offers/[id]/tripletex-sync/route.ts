/**
 * Alias. Den kanoniske ruten er /api/offers/[id]/regnskap-sync — den håndterer
 * både Fiken og Tripletex. Denne står igjen fordi klienter i felten kan kalle
 * den; den skal aldri fjernes uten at vi vet at ingen bruker den.
 */
export { GET, POST } from "@/app/api/offers/[id]/regnskap-sync/route"
