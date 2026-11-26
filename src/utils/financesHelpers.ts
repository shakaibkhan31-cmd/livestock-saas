import { STAGGERED_BATCH_DEFINITIONS } from '@/utils/wallets'

export function getPakistanDateString(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function addDaysToDateString(dateStr: string, daysToAdd: number): string {
  const clean = String(dateStr).split('T')[0]
  const parts = clean.split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => isNaN(n))) return clean
  const [y, m, d] = parts
  const base = new Date(y, m - 1, d + daysToAdd)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(
    base.getDate()
  ).padStart(2, '0')}`
}

export function distributeExactShares(totalPool: number, weights: number[]): number[] {
  const n = weights.length
  if (n === 0 || totalPool <= 0) return weights.map(() => 0)
  const weightSum = weights.reduce((s, w) => s + w, 0)
  if (weightSum <= 0) return weights.map(() => 0)

  const shares = weights.map(w => Math.floor((totalPool * w) / weightSum))
  const allocatedSum = shares.reduce((s, v) => s + v, 0)
  const remainder = totalPool - allocatedSum
  shares[n - 1] = Math.max(0, shares[n - 1] + remainder)
  return shares
}

export const SPECIES_OPTIONS = [
  'Goat',
  'Sheep',
  'Cattle',
  'Buffalo',
  'Chicken',
  'Rabbit',
  'Horse',
  'Dog',
  'Quail',
  'Shared (All Species)',
]

export const WALLET_FUND_SOURCE_TYPES = [
  'OWNER_CONTRIBUTION',
  'BANK_TRANSFER',
  'WALLET_TRANSFER',
  'ADJUSTMENT',
] as const

export const OVERHEAD_SHARE_CATEGORY = 'Farm Overhead / Deficit Share'

export function isFeedCategory(category?: string | null): boolean {
  const c = String(category || '').trim().toLowerCase()
  return c.includes('feed') || c.includes('ration')
}

export function isOverheadShareCategory(category?: string | null): boolean {
  return String(category || '').trim() === OVERHEAD_SHARE_CATEGORY
}

export function isVoidText(val?: string | null): boolean {
  const upper = String(val || '').trim().toUpperCase()
  return upper.startsWith('[VOID]') || upper.startsWith('VOID:')
}

export function isMeatFatteningRole(role?: string | null): boolean {
  const normalized = String(role || 'Meat / Fattening').trim().toLowerCase()
  return normalized === 'meat / fattening' || normalized === 'meat' || normalized === 'fattening'
}

export function normalizeText(val?: string | null): string {
  return String(val || '').trim().toLowerCase()
}

export function isSelfOwnership(ownership?: string | null): boolean {
  const norm = normalizeText(ownership)
  return norm === 'self' || norm === 'farm' || norm === 'farm owned' || norm === 'own'
}

export function isActiveStatus(status?: string | null): boolean {
  const norm = normalizeText(status)
  return norm === '' || norm === 'active'
}

export function isChickenSpecies(species?: string | null): boolean {
  const norm = normalizeText(species)
  return norm === 'chicken' || norm === 'poultry'
}

export function isAseelChick(animal: { cash_cycle_role?: string | null; tag_id?: string | null }): boolean {
  const roleLower = normalizeText(animal.cash_cycle_role)
  const tagLower = normalizeText(animal.tag_id)
  return roleLower.includes('chick') || tagLower.includes('chick')
}

export function inferBatchLabelFromAcquisition(acqDate?: string | null, fallbackDate?: string): string {
  const src = String(acqDate || fallbackDate || '').split('T')[0]
  const month = parseInt(src.split('-')[1] || '1', 10)
  if (month >= 1 && month <= 2) return STAGGERED_BATCH_DEFINITIONS[0].label
  if (month >= 3 && month <= 4) return STAGGERED_BATCH_DEFINITIONS[1].label
  if (month >= 5 && month <= 6) return STAGGERED_BATCH_DEFINITIONS[2].label
  if (month >= 7 && month <= 8) return STAGGERED_BATCH_DEFINITIONS[0].label
  if (month >= 9 && month <= 10) return STAGGERED_BATCH_DEFINITIONS[1].label
  return STAGGERED_BATCH_DEFINITIONS[2].label
}

export function parseSplitRoleFromNotes(notes?: string | null): '60_CAP' | '20_OPS' | '20_OWN' | null {
  const s = String(notes || '')
  if (s.includes('SPLIT_60_CAPITAL')) return '60_CAP'
  if (s.includes('SPLIT_20_OPERATING')) return '20_OPS'
  if (s.includes('SPLIT_20_OWNER_PROFIT')) return '20_OWN'
  return null
}

export function extractSpeciesFromTxn(txn: { target_species?: string | null; description?: string | null }): string {
  const colVal = (txn.target_species || '').trim()
  if (colVal) return colVal

  const desc = txn.description || ''
  const match = desc.match(/\[Species:\s*([^\]]+)\]/i)
  if (match && match[1]) {
    return match[1].trim()
  }
  return 'Shared (All Species)'
}

export function stripSpeciesTag(description?: string | null): string {
  if (!description) return ''
  return description.replace(/\s*\[Species:\s*[^\]]+\]\s*/gi, ' ').trim()
}

export function formatPakistanWhatsAppPhone(rawPhone?: string | null): string | null {
  if (!rawPhone) return null
  const digits = rawPhone.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('0092')) return digits.slice(2)
  if (digits.startsWith('92')) return digits
  if (digits.startsWith('03') && digits.length === 11) return `92${digits.slice(1)}`
  if (digits.startsWith('3') && digits.length === 10) return `92${digits}`
  return digits.length >= 10 ? digits : null
}

export function buildPalaiWhatsAppReminderUrl({
  farmName,
  clientName,
  tagId,
  species,
  monthlyFee,
  billedMonths,
  totalBilled,
  totalPaid,
  balanceDue,
  phone,
}: {
  farmName: string
  clientName: string
  tagId: string
  species: string
  monthlyFee: number
  billedMonths: number
  totalBilled: number
  totalPaid: number
  balanceDue: number
  phone?: string | null
}): string {
  const message = [
    `Assalam-o-Alaikum ${clientName},`,
    ``,
    `Friendly Palai boarding reminder from *${farmName}*:`,
    `• Animal Tag: *${tagId}* (${species})`,
    `• Monthly Rate: Rs. ${monthlyFee.toLocaleString()}/month (${billedMonths} mo)`,
    `• Total Billed: Rs. ${totalBilled.toLocaleString()}`,
    `• Paid to Date: Rs. ${totalPaid.toLocaleString()}`,
    `• *Pending Balance Due: Rs. ${balanceDue.toLocaleString()}*`,
    ``,
    `Kindly share confirmation once transferred. JazakAllah!`,
  ].join('\n')

  const encoded = encodeURIComponent(message)
  const formattedPhone = formatPakistanWhatsAppPhone(phone)
  return formattedPhone
    ? `https://wa.me/${formattedPhone}?text=${encoded}`
    : `https://wa.me/?text=${encoded}`
}

export function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]
  const idx = Math.max(0, Math.min(11, (parseInt(m || '1', 10) || 1) - 1))
  return `${monthNames[idx]} ${y || ''}`.trim()
}