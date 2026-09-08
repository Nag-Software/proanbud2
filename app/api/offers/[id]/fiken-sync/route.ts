/**
 * Alias. Den kanoniske ruten er /api/offers/[id]/regnskap-sync.
 *
 * MERK: denne ruten manglet både rolle- og plansjekk før den ble et alias —
 * hvem som helst med en økt kunne utløse skriving mot kundens regnskap. Ved å
 * peke hit arver den vaktene den alltid skulle hatt.
 */
export { GET, POST } from "@/app/api/offers/[id]/regnskap-sync/route"
