import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getUserFarmAndRole } from '@/utils/rbac'
import OverviewTab from '@/components/finances/OverviewTab'
import LedgerTab from '@/components/finances/LedgerTab'
import WalletsTab from '@/components/finances/WalletsTab'
import PalaiStockTab from '@/components/finances/PalaiStockTab'

export type FinancesTabKey = 'overview' | 'ledger' | 'wallets' | 'palai'

const FINANCES_TABS: Array<{ key: FinancesTabKey; label: string; shortLabel: string }> = [
  { key: 'overview', label: '1. Overview', shortLabel: 'Overview' },
  { key: 'ledger', label: '2. Ledger', shortLabel: 'Ledger' },
  { key: 'wallets', label: '3. Wallets & P&L', shortLabel: 'Wallets & P&L' },
  { key: 'palai', label: '4. Palai & Stock', shortLabel: 'Palai & Stock' },
]

function resolveFinancesTab(rawTab?: string): FinancesTabKey {
  if (rawTab === 'ledger' || rawTab === 'wallets' || rawTab === 'palai') {
    return rawTab
  }
  return 'overview'
}

function TabContentSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        <div className="h-28 bg-white rounded-2xl border border-slate-200 p-5" />
        <div className="h-28 bg-white rounded-2xl border border-slate-200 p-5" />
        <div className="h-28 bg-white rounded-2xl border border-slate-200 p-5" />
        <div className="h-28 bg-white rounded-2xl border border-slate-200 p-5" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-72 bg-white rounded-2xl border border-slate-200 p-6" />
        <div className="h-72 bg-white rounded-2xl border border-slate-200 p-6" />
      </div>
    </div>
  )
}

export default async function FinancesPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string
    msg?: string
    error?: string
    filter?: string
    q?: string
    page?: string
  }>
}) {
  const params = await searchParams
  const activeTab = resolveFinancesTab(params.tab)
  const statusMsg = params.msg
  const errorMsg = params.error

  // RBAC Check: Only Admin can access Finances & P&L
  const { user, farm, role } = await getUserFarmAndRole()
  if (!user) return redirect('/login')
  if (!farm) return redirect('/onboarding')
  if (role !== 'admin') {
    return redirect(
      '/animals?error=' +
        encodeURIComponent('Access Denied: Financial ledger is restricted to Admin only.')
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8 sm:py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                Admin Ledger &amp; 4-Wallet Cash Engine
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mt-1">
              Financials &amp; Billing
            </h1>
            <p className="text-xs sm:text-sm text-slate-500">
              4 Wallets discipline, linked 60/20/20 sale split, VOID audit reconciliation &amp; Palai billing
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/contacts"
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl shadow-sm transition text-sm"
            >
              👥 Contacts Directory
            </Link>
            <Link
              href="/animals"
              className="inline-flex items-center justify-center px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-medium rounded-xl border border-slate-200 shadow-sm transition text-sm"
            >
              ← Back to Livestock Master
            </Link>
          </div>
        </div>

        {/* Feedback Banners */}
        {statusMsg && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-sm flex items-center justify-between gap-3">
            <span>
              <strong>Success:</strong> {decodeURIComponent(statusMsg)}
            </span>
            <Link
              href={`/finances?tab=${activeTab}`}
              className="text-emerald-600 font-bold hover:text-emerald-900 shrink-0"
            >
              ×
            </Link>
          </div>
        )}
        {errorMsg && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm flex items-center justify-between gap-3">
            <span>
              <strong>Error:</strong> {decodeURIComponent(errorMsg)}
            </span>
            <Link
              href={`/finances?tab=${activeTab}`}
              className="text-red-500 font-bold hover:text-red-800 shrink-0"
            >
              ×
            </Link>
          </div>
        )}

        {/* Mobile-First Sticky/Scrollable Tab Navigation */}
        <nav
          aria-label="Financials Tabs"
          className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-200"
        >
          {FINANCES_TABS.map(tab => {
            const isActive = activeTab === tab.key
            return (
              <Link
                key={tab.key}
                href={`/finances?tab=${tab.key}`}
                className={`px-4 py-2.5 rounded-t-xl text-xs sm:text-sm font-semibold whitespace-nowrap border-b-2 transition ${
                  isActive
                    ? 'bg-white text-slate-900 border-emerald-600 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/60 border-transparent'
                }`}
              >
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
              </Link>
            )
          })}
        </nav>

        {/* Active Tab View Streamed Independently via Suspense */}
        <Suspense key={activeTab} fallback={<TabContentSkeleton />}>
          {activeTab === 'overview' && <OverviewTab farmId={farm.id} />}
          {activeTab === 'ledger' && (
            <LedgerTab
              farmId={farm.id}
              farmName={farm.farm_name || 'farm'}
              filterParam={params.filter}
              qParam={params.q}
              pageParam={params.page}
            />
          )}
          {activeTab === 'wallets' && <WalletsTab farmId={farm.id} />}
          {activeTab === 'palai' && (
            <PalaiStockTab farmId={farm.id} farmName={farm.farm_name || 'BAA BAA Shed'} />
          )}
        </Suspense>
      </div>
    </div>
  )
}