export interface WeightLogEntry {
  weight_kg: number | string
  recorded_date: string
}

export interface BreakEvenInput {
  purchaseCost: number
  loggedExpenses: number
  activeDays: number
  latestWeight: number | null
  adgKgPerDay: number | null
  commissionPct?: number
  transportCost?: number
  agentFeeCost?: number
}

export interface BreakEvenResult {
  totalCostOutflow: number
  dailyBurnRate: number
  breakEvenToday: number
  breakEven30Days: number
  breakEven60Days: number
  perKgToday: number | null
  perKg30Days: number | null
  perKg60Days: number | null
  projWeight30: number | null
  projWeight60: number | null
  extraCost30: number
  extraCost60: number
}

export interface PoolAnimalInput {
  id: string
  tag_id: string
  species: string
  acquisition_date?: string | null
}

export interface WeightedPoolAnimal extends PoolAnimalInput {
  acqStr: string | null
  tenureDays: number
  rawWeight: number
  effectiveWeight: number
  weightSource: 'Logged' | 'Species Avg' | 'Tenure Days'
  basisNote: string
}

export function daysBetweenDateStrings(
  startStr?: string | null,
  endStr?: string | null,
  fallbackDays = 30
): number {
  if (!startStr || !endStr) return fallbackDays
  const s = new Date(`${String(startStr).split('T')[0]}T00:00:00Z`).getTime()
  const e = new Date(`${String(endStr).split('T')[0]}T00:00:00Z`).getTime()
  if (isNaN(s) || isNaN(e)) return fallbackDays
  return Math.max(1, Math.round((e - s) / (1000 * 60 * 60 * 24)))
}

export function formatDateDDMMYYYY(dateInput?: string | null): string {
  if (!dateInput) return 'N/A'
  const datePart = String(dateInput).split('T')[0]
  const parts = datePart.split('-')
  if (parts.length === 3) {
    const [year, month, day] = parts
    return `${day}/${month}/${year}`
  }
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return 'N/A'
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

/**
 * Computes Average Daily Gain (ADG in kg/day) from weight logs sorted newest-first.
 */
export function calculateAdgKgPerDay(weightLogs?: WeightLogEntry[] | null): number | null {
  if (!weightLogs || weightLogs.length < 2) return null
  const newest = weightLogs[0]
  const oldest = weightLogs[weightLogs.length - 1]
  const spanDays = daysBetweenDateStrings(oldest.recorded_date, newest.recorded_date, 1)
  return (Number(newest.weight_kg) - Number(oldest.weight_kg)) / spanDays
}

/**
 * Single source of truth for farm-owned (Self) animal break-even, daily burn, and future projections.
 */
export function calculateAnimalBreakEven(input: BreakEvenInput): BreakEvenResult {
  const {
    purchaseCost,
    loggedExpenses,
    activeDays,
    latestWeight,
    adgKgPerDay,
    commissionPct = 3,
    transportCost = 0,
    agentFeeCost = 0,
  } = input

  const safeActiveDays = Math.max(1, activeDays)
  const totalCostOutflow = Math.max(0, purchaseCost) + Math.max(0, loggedExpenses)
  const dailyBurnRate = loggedExpenses > 0 ? Math.round(loggedExpenses / safeActiveDays) : 0

  const fixedSellingCosts = Math.max(0, transportCost) + Math.max(0, agentFeeCost)
  const commFactor = Math.max(0.05, 1 - Math.max(0, commissionPct) / 100)

  const calcHorizon = (futureDays: number) => {
    const projectedCost = totalCostOutflow + dailyBurnRate * futureDays + fixedSellingCosts
    return Math.round(projectedCost / commFactor)
  }

  const breakEvenToday = calcHorizon(0)
  const breakEven30Days = calcHorizon(30)
  const breakEven60Days = calcHorizon(60)

  const hasValidWeight = latestWeight !== null && latestWeight > 0

  const perKgToday = hasValidWeight ? Math.round(breakEvenToday / latestWeight) : null

  const projWeight30 =
    hasValidWeight && adgKgPerDay !== null
      ? Number(Math.max(latestWeight, latestWeight + adgKgPerDay * 30).toFixed(1))
      : null

  const projWeight60 =
    hasValidWeight && adgKgPerDay !== null
      ? Number(Math.max(latestWeight, latestWeight + adgKgPerDay * 60).toFixed(1))
      : null

  const perKg30Days =
    projWeight30 !== null && projWeight30 > 0 ? Math.round(breakEven30Days / projWeight30) : null

  const perKg60Days =
    projWeight60 !== null && projWeight60 > 0 ? Math.round(breakEven60Days / projWeight60) : null

  return {
    totalCostOutflow,
    dailyBurnRate,
    breakEvenToday,
    breakEven30Days,
    breakEven60Days,
    perKgToday,
    perKg30Days,
    perKg60Days,
    projWeight30,
    projWeight60,
    extraCost30: dailyBurnRate * 30,
    extraCost60: dailyBurnRate * 60,
  }
}

/**
 * Computes weightage for deficit/overhead allocation across eligible Self animals:
 * 1. Filters animals acquired on or before refDateStr.
 * 2. Uses logged weight if available.
 * 3. Falls back to Species Average Weight (if any peer in the pool has a weight log),
 *    or Acquisition Tenure Days (never an arbitrary 1kg fallback).
 */
export function computeWeightedAnimalsForPool(
  poolAnimals: PoolAnimalInput[],
  latestWeightByAnimal: Record<string, number>,
  refDateStr: string
): WeightedPoolAnimal[] {
  const eligible = poolAnimals.filter(a => {
    if (!a.acquisition_date) return true
    return String(a.acquisition_date).split('T')[0] <= refDateStr
  })

  const loggedWeights = eligible
    .map(a => latestWeightByAnimal[a.id] ?? 0)
    .filter(w => w > 0)

  const speciesAvgWeight =
    loggedWeights.length > 0
      ? loggedWeights.reduce((sum, w) => sum + w, 0) / loggedWeights.length
      : 0

  return eligible.map(a => {
    const rawWeight = latestWeightByAnimal[a.id] ?? 0
    const acqStr = a.acquisition_date ? String(a.acquisition_date).split('T')[0] : null
    const tenureDays = acqStr ? daysBetweenDateStrings(acqStr, refDateStr, 30) : 30

    let effectiveWeight = rawWeight
    let weightSource: WeightedPoolAnimal['weightSource'] = 'Logged'
    let basisNote = `${rawWeight} kg logged`

    if (rawWeight > 0) {
      effectiveWeight = rawWeight
      weightSource = 'Logged'
      basisNote = `${rawWeight} kg logged`
    } else if (speciesAvgWeight > 0) {
      effectiveWeight = Number(speciesAvgWeight.toFixed(1))
      weightSource = 'Species Avg'
      basisNote = `~${effectiveWeight} kg species avg (Acq: ${formatDateDDMMYYYY(acqStr)})`
    } else {
      effectiveWeight = tenureDays
      weightSource = 'Tenure Days'
      basisNote = `${tenureDays}d tenure since Acq: ${formatDateDDMMYYYY(acqStr)}`
    }

    return {
      ...a,
      acqStr,
      tenureDays,
      rawWeight,
      effectiveWeight,
      weightSource,
      basisNote,
    }
  })
}