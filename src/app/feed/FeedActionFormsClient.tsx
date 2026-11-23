'use client'

import { useState } from 'react'

interface PurchaseRowItem {
  id: number
  feed_type: string
  quantity_kg: string
  total_cost: string
}

interface AdjustmentRowItem {
  id: number
  feed_type: string
  target_remaining_kg: string
}

interface FeedActionFormsClientProps {
  speciesOptions: string[]
  defaultSpecies: string
  todayStr: string
  isAdmin: boolean
  addFeedLogAction: (formData: FormData) => void | Promise<void>
  adjustFeedStockAction?: (formData: FormData) => void | Promise<void>
}

export default function FeedActionFormsClient({
  speciesOptions,
  defaultSpecies,
  todayStr,
  isAdmin,
  addFeedLogAction,
}: FeedActionFormsClientProps) {
  const [purchaseRows, setPurchaseRows] = useState<PurchaseRowItem[]>([
    { id: 1, feed_type: '', quantity_kg: '', total_cost: '' },
  ])

  const [adjRows, setAdjRows] = useState<AdjustmentRowItem[]>([
    { id: 1, feed_type: '', target_remaining_kg: '0' },
  ])

  const liveBillTotal = purchaseRows.reduce((sum, row) => {
    const val = parseFloat(row.total_cost) || 0
    return sum + (val > 0 ? val : 0)
  }, 0)

  const handleAddPurchaseRow = () => {
    setPurchaseRows(prev => [
      ...prev,
      { id: Date.now() + Math.random(), feed_type: '', quantity_kg: '', total_cost: '' },
    ])
  }

  const handleRemovePurchaseRow = (id: number) => {
    setPurchaseRows(prev => (prev.length > 1 ? prev.filter(r => r.id !== id) : prev))
  }

  const handlePurchaseChange = (
    id: number,
    field: keyof Omit<PurchaseRowItem, 'id'>,
    value: string
  ) => {
    setPurchaseRows(prev =>
      prev.map(row => (row.id === id ? { ...row, [field]: value } : row))
    )
  }

  const handleAddAdjRow = () => {
    setAdjRows(prev => [
      ...prev,
      { id: Date.now() + Math.random(), feed_type: '', target_remaining_kg: '0' },
    ])
  }

  const handleRemoveAdjRow = (id: number) => {
    setAdjRows(prev => (prev.length > 1 ? prev.filter(r => r.id !== id) : prev))
  }

  const handleAdjChange = (
    id: number,
    field: keyof Omit<AdjustmentRowItem, 'id'>,
    value: string
  ) => {
    setAdjRows(prev =>
      prev.map(row => (row.id === id ? { ...row, [field]: value } : row))
    )
  }

  return (
    <div className="lg:col-span-5 space-y-5 lg:sticky lg:top-6">
      {/* Card A: Record Bulk Purchase (Stock-In) */}
      <div
        id="purchase-panel"
        className="bg-white rounded-2xl shadow-xs border border-slate-200/90 p-5 space-y-4"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Record Bulk Purchase</h2>
            <p className="text-[11px] text-slate-500">
              Add ration stock-in &amp; deduct operating wallet
            </p>
          </div>
          <button
            type="button"
            onClick={handleAddPurchaseRow}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-200 transition"
          >
            + Add Item
          </button>
        </div>

        <form action={addFeedLogAction} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Target Species *
              </label>
              <select
                name="target_species"
                defaultValue={defaultSpecies}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600"
              >
                {speciesOptions.map(sp => (
                  <option key={sp} value={sp}>
                    {sp}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Purchase Date *
              </label>
              <input
                name="log_date"
                type="date"
                required
                defaultValue={todayStr}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          <div className="space-y-2.5">
            {purchaseRows.map((row, index) => (
              <div
                key={row.id}
                className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <input
                    name="feed_type"
                    type="text"
                    list="common-feeds"
                    required
                    value={row.feed_type}
                    onChange={e => handlePurchaseChange(row.id, 'feed_type', e.target.value)}
                    placeholder="Ration item (e.g., Channa Chilka)"
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-900 focus:ring-2 focus:ring-emerald-600"
                  />
                  {purchaseRows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemovePurchaseRow(row.id)}
                      aria-label={`Remove purchase item ${index + 1}`}
                      className="px-2 py-1 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg"
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    name="quantity_kg"
                    type="number"
                    step="0.1"
                    min="0.1"
                    required
                    value={row.quantity_kg}
                    onChange={e => handlePurchaseChange(row.id, 'quantity_kg', e.target.value)}
                    placeholder="Qty (KG)"
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:ring-2 focus:ring-emerald-600"
                  />
                  <input
                    name="total_cost"
                    type="number"
                    step="1"
                    min="1"
                    required
                    value={row.total_cost}
                    onChange={e => handlePurchaseChange(row.id, 'total_cost', e.target.value)}
                    placeholder="Cost (PKR)"
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900 focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="px-3.5 py-2.5 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider">
              Bill Total:
            </span>
            <span className="text-sm font-bold font-mono text-emerald-700">
              Rs. {liveBillTotal.toLocaleString()}
            </span>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Vendor / Notes
            </label>
            <input
              name="notes"
              type="text"
              placeholder="e.g., Afzaal Memon Traders"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:bg-white focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition font-semibold text-xs sm:text-sm shadow-xs"
          >
            Save Bulk Purchase(s)
          </button>
        </form>
      </div>

      {/* Card B: Stock Adjustment / Closing Count */}
      {isAdmin && (
        <div
          id="adjustment-panel"
          className="bg-white rounded-2xl shadow-xs border border-slate-200/90 p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Stock Adjustment / Closing</h2>
              <p className="text-[11px] text-slate-500">
                Enter remaining physical kg (logs consumption pool or stock correction)
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddAdjRow}
              className="text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg border border-slate-300 transition"
            >
              + Add Item
            </button>
          </div>

          <form action="/api/feed/adjust-stock" method="POST" className="space-y-3.5">
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Target Species
                </label>
                <select
                  name="target_species"
                  defaultValue={defaultSpecies}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900"
                >
                  {speciesOptions.map(sp => (
                    <option key={sp} value={sp}>
                      {sp}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  Closing Date
                </label>
                <input
                  name="log_date"
                  type="date"
                  required
                  defaultValue={todayStr}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                Reason / Label
              </label>
              <input
                name="notes"
                type="text"
                defaultValue="Weekly Closing Adjustment"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900"
              />
            </div>

            <div className="space-y-2">
              {adjRows.map((row, idx) => (
                <div
                  key={row.id}
                  className="grid grid-cols-12 gap-2 items-center p-2.5 bg-slate-50 rounded-xl border border-slate-200"
                >
                  <div className="col-span-7">
                    <input
                      name="feed_type"
                      type="text"
                      list="common-feeds"
                      required
                      value={row.feed_type}
                      onChange={e => handleAdjChange(row.id, 'feed_type', e.target.value)}
                      placeholder="Item name"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900"
                    />
                  </div>
                  <div className="col-span-3">
                    <input
                      name="target_remaining_kg"
                      type="number"
                      step="0.1"
                      min="0"
                      required
                      value={row.target_remaining_kg}
                      onChange={e =>
                        handleAdjChange(row.id, 'target_remaining_kg', e.target.value)
                      }
                      title="Remaining Physical KG"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-900"
                    />
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-1">
                    <span className="text-[10px] font-mono text-slate-400">#{idx + 1}</span>
                    {adjRows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveAdjRow(row.id)}
                        aria-label={`Remove adjustment item ${idx + 1}`}
                        className="px-1.5 py-0.5 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <label className="flex items-center gap-2 text-[11px] text-slate-700 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 cursor-pointer">
              <input
                type="checkbox"
                name="already_allocated"
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span>Cost already allocated (do not add to Pending Consumption Pool)</span>
            </label>

            <button
              type="submit"
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition font-semibold text-xs shadow-xs"
            >
              Apply Stock Adjustments
            </button>
          </form>
        </div>
      )}
    </div>
  )
}