import { connection } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { getUserFarmAndRole } from '@/utils/rbac'
import FeedCommandCenterClient from './FeedCommandCenterClient'
import {
  addFeedLog,
  deleteFeedLog,
  restoreFeedLog,
  adjustFeedStock,
  allocateFeedCostToAnimals,
  updateFeedThreshold,
} from './actions'

export const dynamic = 'force-dynamic'

type ActiveAnimalRow = {
  id: string
  tag_id: string
  species: string
  ownership?: string | null
  client_name?: string | null
  acquisition_date?: string | null
}

function getKarachiDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function isNextRedirectError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const digest = (err as { digest?: unknown }).digest
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')
}

const SPECIES_OPTIONS = [
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

const DEFAULT_FEED_SUGGESTIONS = [
  'Kala Chana',
  'Channa Chilka',
  'Soya Bean Chilka',
  'Gandum (Wheat)',
  'Gandum Daliya',
  'Chokar (Wheat Bran)',
  'Bhoosa',
  'Alfalfa Hay / Lucerne',
  'Mong Phalli Missa',
  'Mix Dana / Wanda',
  'Khal',
  'Jau (Barley)',
  'Makai (Maize)',
  'Mineral Mixture & DCP',
  'Maymil Milk Powder',
  'Chicken Starter / Layer Feed',
  'Rabbit Pellets / Dry Lucerne',
]

const DEFAULT_THRESHOLDS_BY_KEY: Record<string, number> = {
  'mineral mixture & dcp': 1,
  'mineral mixture': 1,
  'dcp': 1,
  'maymil milk powder': 2,
  'maymil': 2,
  'bhoosa': 30,
  'kala chana': 5,
  'channa chilka': 10,
  'soya bean chilka': 20,
  'gandum (wheat)': 15,
  'gandum': 15,
  'gandum daliya': 5,
  'chokar (wheat bran)': 30,
  'alfalfa hay / lucerne': 20,
  'alfalfa hay': 20,
  'mong phalli missa': 20,
  'mix dana / wanda': 30,
  'khal': 20,
  'jau (barley)': 15,
  'makai (maize)': 15,
  'chicken starter / layer feed': 15,
  'rabbit pellets / dry lucerne': 10,
}

const DEFAULT_FALLBACK_THRESHOLD_KG = 10

function getDefaultThresholdForFeed(feedName: string): number {
  const key = String(feedName || '').trim().toLowerCase()
  if (!key) return DEFAULT_FALLBACK_THRESHOLD_KG
  if (DEFAULT_THRESHOLDS_BY_KEY[key] !== undefined) {
    return DEFAULT_THRESHOLDS_BY_KEY[key]
  }
  for (const [k, val] of Object.entries(DEFAULT_THRESHOLDS_BY_KEY)) {
    if (key.includes(k) || k.includes(key)) {
      return val
    }
  }
  return DEFAULT_FALLBACK_THRESHOLD_KG
}

export default async function FeedManagementPage({
  searchParams,
}: {
  searchParams: Promise<{
    msg?: string
    error?: string
    species?: string
    splitDate?: string
    entryType?: string
    alloc?: string
    q?: string
    page?: string
    from?: string
    to?: string
    lowOnly?: string
    undo?: string
  }>
}) {
  await connection()

  const params = await searchParams
  const statusMsg = params.msg
  const selectedSpeciesFilter = params.species || 'All'
  const selectedEntryType =
    params.entryType === 'Purchase' || params.entryType === 'Consumption' ? params.entryType : 'All'
  const selectedAllocFilter =
    params.alloc === 'Pending' || params.alloc === 'Allocated' ? params.alloc : 'All'
  const searchQuery = (params.q || '').trim()
  const fromDateFilter = (params.from || '').trim()
  const toDateFilter = (params.to || '').trim()
  const lowStockOnlyFilter = params.lowOnly === '1'
  const undoPayloadEncoded = params.undo || ''

  const { user, farm, role } = await getUserFarmAndRole()
  if (!user) return redirect('/login')
  if (!farm) return redirect('/onboarding')
  const isAdmin = role === 'admin'

  const supabase = await createClient()
  const todayStr = getKarachiDate()

  let loadErrorMsg = params.error || ''
  let allFeedLogs: Array<Record<string, any>> = []
  let activeAnimals: ActiveAnimalRow[] = []
  let inventoryRows: Array<Record<string, any>> = []
  let thresholdRows: Array<Record<string, any>> = []

  try {
    const [logsRes, animalsRes, invRes, threshRes] = await Promise.all([
      supabase
        .from('feed_logs')
        .select('*')
        .eq('farm_id', farm.id)
        .order('log_date', { ascending: false }),
      supabase
        .from('livestock_master')
        .select('id, tag_id, species, ownership, client_name, acquisition_date')
        .eq('farm_id', farm.id)
        .eq('status', 'Active'),
      supabase
        .from('feed_inventory')
        .select('*')
        .eq('farm_id', farm.id),
      supabase
        .from('feed_thresholds')
        .select('feed_name, min_stock_kg')
        .eq('farm_id', farm.id),
    ])

    if (logsRes.error) {
      loadErrorMsg = loadErrorMsg || logsRes.error.message
    } else {
      allFeedLogs = logsRes.data || []
    }

    if (animalsRes.error) {
      loadErrorMsg = loadErrorMsg || animalsRes.error.message
    } else {
      activeAnimals = (animalsRes.data || []) as ActiveAnimalRow[]
    }

    if (!invRes.error) {
      inventoryRows = invRes.data || []
    }

    if (!threshRes.error) {
      thresholdRows = threshRes.data || []
    }
  } catch (err: unknown) {
    if (isNextRedirectError(err)) throw err
    loadErrorMsg =
      loadErrorMsg ||
      (err instanceof Error ? err.message : 'Failed loading feed data from the database.')
  }

  const dynamicFeedSuggestions = Array.from(
    new Set([
      ...DEFAULT_FEED_SUGGESTIONS,
      ...allFeedLogs.map(l => String(l.feed_type || '').trim()).filter(Boolean),
      ...inventoryRows.map(r => String(r.feed_name || r.item_name || '').trim()).filter(Boolean),
      ...thresholdRows.map(t => String(t.feed_name || '').trim()).filter(Boolean),
    ])
  ).sort()

  const dbThresholdMap: Record<string, number> = {}
  thresholdRows.forEach(row => {
    const key = String(row.feed_name || '').trim().toLowerCase()
    const numVal = Number(row.min_stock_kg)
    if (key && Number.isFinite(numVal) && numVal >= 0) {
      dbThresholdMap[key] = numVal
    }
  })

  const thresholdByFeedName: Record<string, number> = {}
  dynamicFeedSuggestions.forEach(feedName => {
    const key = feedName.trim().toLowerCase()
    thresholdByFeedName[key] =
      dbThresholdMap[key] !== undefined ? dbThresholdMap[key] : getDefaultThresholdForFeed(feedName)
  })

  return (
    <FeedCommandCenterClient
      farmName={farm?.farm_name || 'Livestock ERP'}
      role={role || 'staff'}
      isAdmin={isAdmin}
      todayStr={todayStr}
      speciesOptions={SPECIES_OPTIONS}
      dynamicFeedSuggestions={dynamicFeedSuggestions}
      allFeedLogs={allFeedLogs}
      activeAnimals={activeAnimals}
      thresholdByFeedName={thresholdByFeedName}
      initialSpeciesFilter={selectedSpeciesFilter}
      initialEntryType={selectedEntryType}
      initialAllocFilter={selectedAllocFilter}
      initialSearchQuery={searchQuery}
      initialFromDate={fromDateFilter}
      initialToDate={toDateFilter}
      initialLowOnly={lowStockOnlyFilter}
      initialSplitDate={(params.splitDate || todayStr).split('T')[0]}
      statusMsg={statusMsg ? decodeURIComponent(statusMsg) : ''}
      errorMsg={loadErrorMsg ? decodeURIComponent(loadErrorMsg) : ''}
      undoPayload={undoPayloadEncoded}
      addFeedLogAction={addFeedLog}
      deleteFeedLogAction={deleteFeedLog}
      restoreFeedLogAction={restoreFeedLog}
      adjustFeedStockAction={adjustFeedStock}
      allocateFeedCostAction={allocateFeedCostToAnimals}
      updateFeedThresholdAction={updateFeedThreshold}
    />
  )
}