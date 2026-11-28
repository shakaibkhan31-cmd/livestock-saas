import type { CSSProperties, ReactNode } from 'react'
import { notFound, redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { Gochi_Hand, Poppins } from 'next/font/google'
import { createClient } from '@/utils/supabase/server'
import { getUserFarmAndRole } from '@/utils/rbac'
import { daysBetweenDateStrings } from '@/utils/breakeven'
import { addDaysToDateString, isVoidText } from '@/utils/financesHelpers'
import PrintButton from './PrintButton'
import WhatsAppPdfButton from './WhatsAppPdfButton'

const brandFont = Gochi_Hand({ weight: '400', subsets: ['latin'] })
const bodyFont = Poppins({ weight: ['400', '500', '600', '700'], subsets: ['latin'] })

// ---------- Colors (from the reference receipt) ----------
const MAROON = '#7a2e28'
const GREEN = '#3b6b32'
const INK = '#1b1245'

// ---------- Helpers ----------
const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function below1000(n: number): string {
  const parts: string[] = []
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`)
    n = n % 100
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''))
  } else if (n > 0) {
    parts.push(ONES[n])
  }
  return parts.join(' ')
}

// Pakistani numbering: Thousand, Lakh, Crore
function numberToWords(value: number): string {
  let n = Math.floor(Math.abs(value))
  if (n === 0) return 'Zero'
  const crore = Math.floor(n / 10000000)
  const lakh = Math.floor((n % 10000000) / 100000)
  const thousand = Math.floor((n % 100000) / 1000)
  const rest = n % 1000
  const parts: string[] = []
  if (crore) parts.push(`${below1000(crore)} Crore`)
  if (lakh) parts.push(`${below1000(lakh)} Lakh`)
  if (thousand) parts.push(`${below1000(thousand)} Thousand`)
  if (rest) parts.push(below1000(rest))
  return parts.join(' ')
}

const MONTHS_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

// 'YYYY-MM-DD' -> '07-Feb-2026' (short) or '07-March-2026' (full)
function fmtDate(dateStr: string, full = false): string {
  const [y, m, d] = dateStr.split('-')
  const name = MONTHS_FULL[(parseInt(m, 10) || 1) - 1] || ''
  return `${d}-${full ? name : name.slice(0, 3)}-${y}`
}

function formatWhatsAppNumber(phone?: string | null): string | null {
  if (!phone) return null
  let cleaned = phone.replace(/[\s\-\(\)\+]/g, '')
  if (!cleaned) return null
  if (cleaned.startsWith('0092')) cleaned = cleaned.slice(2)
  if (cleaned.startsWith('92') && cleaned.length === 12) return cleaned
  if (cleaned.startsWith('03') && cleaned.length === 11) cleaned = '92' + cleaned.slice(1)
  else if (cleaned.startsWith('3') && cleaned.length === 10) cleaned = '92' + cleaned
  return cleaned.length === 12 ? cleaned : null
}

// Layout helpers: the receipt is designed on a 2000 x 1000 canvas and scales with its width.
const fs = (px: number) => `${px / 20}cqw`
const pos = (x: number, y: number, w: number, h: number): CSSProperties => ({
  position: 'absolute',
  left: `${x / 20}%`,
  top: `${y / 10}%`,
  width: `${w / 20}%`,
  height: `${h / 10}%`,
})

function Box({
  x,
  y,
  w,
  h,
  children,
  style,
}: {
  x: number
  y: number
  w: number
  h: number
  children?: ReactNode
  style?: CSSProperties
}) {
  return (
    <div style={{ ...pos(x, y, w, h), display: 'flex', alignItems: 'center', ...style }}>
      {children}
    </div>
  )
}

// ---------- Page ----------
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return redirect('/login')

  const { farm } = await getUserFarmAndRole()
  if (!farm) return redirect('/onboarding')

  // 1) Payment log
  const { data: payment } = await supabase
    .from('animal_financial_logs')
    .select('id, animal_id, entry_type, category, amount, transaction_date, notes')
    .eq('id', id)
    .eq('farm_id', farm.id)
    .maybeSingle()

  if (
    !payment ||
    payment.entry_type !== 'Revenue' ||
    payment.category !== 'Palai Boarding Fee' ||
    isVoidText(payment.notes)
  ) {
    return notFound()
  }

  // 2) Animal + all its revenue logs + all farm Palai payments (for fallback S.No.) + client contacts
  const [{ data: animal }, { data: animalLogs }, { data: allPalaiPayments }, { data: contactsList }] =
    await Promise.all([
      supabase
        .from('livestock_master')
        .select('id, tag_id, species, client_name, monthly_palai_fee, acquisition_date')
        .eq('id', payment.animal_id)
        .eq('farm_id', farm.id)
        .maybeSingle(),
      supabase
        .from('animal_financial_logs')
        .select('id, entry_type, amount, notes, transaction_date')
        .eq('farm_id', farm.id)
        .eq('animal_id', payment.animal_id)
        .eq('entry_type', 'Revenue'),
      supabase
        .from('animal_financial_logs')
        .select('id, transaction_date, notes')
        .eq('farm_id', farm.id)
        .eq('entry_type', 'Revenue')
        .eq('category', 'Palai Boarding Fee'),
      supabase.from('contacts').select('name, phone').eq('farm_id', farm.id),
    ])

  if (!animal) return notFound()

  // 3) Same Palai formula as Finances — frozen at payment date
  const rate = Number(animal.monthly_palai_fee) > 0 ? Number(animal.monthly_palai_fee) : 5000
  const paymentDateForCalc = String(payment.transaction_date).split('T')[0]
  const acqStr = animal.acquisition_date
    ? String(animal.acquisition_date).split('T')[0]
    : paymentDateForCalc
  const daysBoarded = Math.max(1, daysBetweenDateStrings(acqStr, paymentDateForCalc, 1))
  const billedMonths = Math.max(1, Math.ceil(daysBoarded / 30))
  const nextBillingDate = addDaysToDateString(acqStr, billedMonths * 30)

  const logsTillThisPayment = (animalLogs || []).filter((f: any) => {
    if (isVoidText(f.notes)) return false
    const d = String((f as any).transaction_date || '').split('T')[0]
    return !d || d <= paymentDateForCalc
  })
  const autoBilled = logsTillThisPayment
    .filter((f: any) => String(f.notes || '').startsWith('Auto-Bill'))
    .reduce((s: number, f: any) => s + (Number(f.amount) || 0), 0)
  const totalRevenue = logsTillThisPayment.reduce(
    (s: number, f: any) => s + (Number(f.amount) || 0),
    0
  )

  const totalBilled = Math.max(rate * billedMonths, autoBilled)
  const totalPaid = Math.max(0, totalRevenue - autoBilled)
  const balanceDueAfter = Math.max(0, totalBilled - totalPaid)
  const paymentAmount = Number(payment.amount) || 0
  const balanceAmount = balanceDueAfter + paymentAmount

  // 4) Receipt No. (with transaction_date sort index + 1 fallback) + Method (with 'Cash' fallback)
  const notes = String(payment.notes || '')
  const explicitReceiptNo = (notes.match(/Receipt:\s*(\d+)/) || [])[1]

  const sortedPayments = (allPalaiPayments || [])
    .filter((p: any) => !isVoidText(p.notes))
    .sort((a: any, b: any) => {
      const da = String(a.transaction_date || '').split('T')[0]
      const db = String(b.transaction_date || '').split('T')[0]
      if (da !== db) return da.localeCompare(db)
      return String(a.id).localeCompare(String(b.id))
    })

  const dateOrderIndex = sortedPayments.findIndex((p: any) => p.id === payment.id)
  const fallbackReceiptNo = String(Math.max(1, dateOrderIndex + 1)).padStart(4, '0')
  const receiptNo = explicitReceiptNo || fallbackReceiptNo

  const extractedMethod = ((notes.match(/Method:\s*([^|]+)/) || [])[1] || '').trim()
  const method = extractedMethod || 'Cash'

  const paymentDate = String(payment.transaction_date).split('T')[0]
  const monthName = MONTHS_FULL[(parseInt(paymentDate.split('-')[1], 10) || 1) - 1]
  const speciesLabel = /goat/i.test(animal.species || '') ? 'Bakra' : animal.species || 'Animal'
  const clientName = animal.client_name || 'Client'
  const amountInWords = numberToWords(paymentAmount) + ' only-'

  // 5) WhatsApp link to the client
  const contact = (contactsList || []).find(
    (c: any) => (c.name || '').trim().toLowerCase() === clientName.trim().toLowerCase()
  )
  const waNumber = formatWhatsAppNumber(contact?.phone)
  const h = await headers()
  const host = h.get('x-forwarded-host') || h.get('host') || ''
  const proto = h.get('x-forwarded-proto') || 'https'
  const receiptUrl = `${proto}://${host}/receipts/${payment.id}`
  const waMessage = `Assalam-o-Alaikum *${clientName}*,\n\nShukriya! *${
    (farm as any).farm_name || 'Baa Baa Shed'
  }* ko aapki Palai payment *Rs. ${paymentAmount.toLocaleString('en-US')}* mosool ho gayi hai.\n\n🧾 Receipt No: ${receiptNo}\n${receiptUrl}\n\nJazakAllah!`
  const whatsappUrl = `https://wa.me/${waNumber || ''}?text=${encodeURIComponent(waMessage)}`

  const fmt = (n: number) => n.toLocaleString('en-US')
  const label: CSSProperties = { color: GREEN, fontWeight: 600, fontSize: fs(34), whiteSpace: 'nowrap' }
  const value: CSSProperties = {
    color: INK,
    fontWeight: 600,
    fontSize: fs(34),
    textDecoration: 'underline',
    whiteSpace: 'nowrap',
  }
  const dotted = '0.1cqw dotted ' + INK

  const methods = ['Cash', 'Online Bank Transfer', 'JazzCash']
  const balanceRows: [string, number, number][] = [
    ['Balance Amount', balanceAmount, 641],
    ['Payment Amount', paymentAmount, 721],
    ['Balance Due', balanceDueAfter, 801],
  ]

  return (
    <div
      className={bodyFont.className}
      style={{ minHeight: '100vh', background: '#f1f5f9', padding: '16px', overflowX: 'clip' }}
    >
      <style>{`
        @media print {
          .no-print { display: none !important }
          nav, aside, header { display: none !important }
          @page { size: A4 landscape; margin: 6mm }
          html, body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
          }
          .receipt-shell {
            max-width: 100% !important;
            width: 100% !important;
            margin: 0 !important;
            overflow: hidden !important;
          }
          .receipt-wrap {
            max-width: 100% !important;
            width: 100% !important;
            padding: 0 !important;
            background: #fff !important;
            overflow: hidden !important;
          }
          .receipt {
            width: 100% !important;
            max-width: 100% !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            overflow: hidden !important;
          }
        }
        .receipt, .receipt * { -webkit-print-color-adjust: exact; print-color-adjust: exact }
      `}</style>

      <div className="receipt-shell max-w-[800px] mx-auto overflow-hidden">
        {/* Action buttons */}
<div
  className="no-print"
  style={{ width: '100%', margin: '0 0 12px', display: 'flex', flexWrap: 'wrap', gap: 8 }}
>
  <PrintButton />
  <WhatsAppPdfButton
    waNumber={waNumber}
    clientName={clientName}
    farmName={(farm as any).farm_name || 'Baa Baa Shed'}
    amountFormatted={fmt(paymentAmount)}
    receiptNo={receiptNo}
  />
</div>

        <div className="receipt-wrap max-w-[800px] mx-auto overflow-hidden">
          <div
            className="receipt"
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '2 / 1',
              containerType: 'inline-size',
              background: '#fff',
              overflow: 'hidden',
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              borderRadius: 8,
            }}
          >
            {/* Decorative background */}
            <svg
              viewBox="0 0 2000 1000"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              aria-hidden="true"
            >
              <path d="M0 0H390C310 40 240 90 160 125C80 160 35 230 0 330Z" fill={MAROON} />
              <path d="M0 0H70C25 55 0 100 0 160Z" fill={GREEN} />
              <g fill="none" stroke="#fff" strokeWidth="3" opacity="0.7">
                <circle cx="95" cy="75" r="45" />
                <circle cx="95" cy="75" r="70" />
                <circle cx="95" cy="75" r="95" />
              </g>
              <path d="M0 330C45 400 65 520 45 640C25 700 0 705 0 705Z" fill={MAROON} />
              <path d="M0 670C70 700 140 780 250 900C275 940 285 980 275 1000H0Z" fill={MAROON} />
              <path d="M0 770C35 810 65 900 90 1000H0Z" fill={GREEN} />
              <g fill="none" stroke="#fff" strokeWidth="3" opacity="0.7">
                <path d="M20 1000C30 950 70 930 130 940" />
                <path d="M60 1000C70 965 100 955 150 962" />
              </g>
              <path d="M390 0H680C660 40 620 82 540 82C470 82 410 50 390 0Z" fill={GREEN} />
              <path
                d="M420 55C470 20 540 35 600 15C640 5 660 20 680 25"
                fill="none"
                stroke={MAROON}
                strokeWidth="9"
                strokeLinecap="round"
              />
              <ellipse cx="935" cy="0" rx="150" ry="45" fill={GREEN} />
              <path
                d="M1130 0H1330C1320 35 1270 85 1195 92C1150 75 1130 40 1130 0Z"
                fill={MAROON}
              />
              {[
                [1360, 8],
                [1325, 30],
                [1270, 45],
                [1240, 58],
                [1270, 62],
              ].map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r={i % 2 ? 7 : 5} fill={GREEN} />
              ))}
              {[
                [720, 15],
                [740, 28],
                [760, 14],
                [755, 46],
                [735, 45],
              ].map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r={6} fill={MAROON} />
              ))}
              <path
                d="M440 1000C470 950 560 930 640 950C700 962 760 990 760 1000Z"
                fill={GREEN}
              />
              <path d="M700 1000C740 960 880 940 960 975L975 1000Z" fill={GREEN} />
              <circle cx="1125" cy="955" r="40" fill={GREEN} />
              <circle cx="1030" cy="985" r="35" fill={MAROON} />
              <circle cx="1215" cy="990" r="32" fill={MAROON} />
              <circle cx="1262" cy="968" r="38" fill="none" stroke={GREEN} strokeWidth="3" />
              <circle cx="320" cy="942" r="11" fill={MAROON} />
              <circle cx="365" cy="980" r="16" fill={GREEN} />
              <circle cx="432" cy="980" r="10" fill={MAROON} />
            </svg>

            {/* Left Logo + Header */}
            <Box
              x={260}
              y={55}
              w={260}
              h={260}
              style={{
                justifyContent: 'center',
                background: 'transparent',
                border: 'none',
                boxShadow: 'none',
              }}
            >
              <img
                src="/logo.png"
                alt="Baa Baa Shed Logo"
                width={240}
                height={240}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: 'transparent',
                  display: 'block',
                }}
              />
            </Box>

            <Box
              x={535}
              y={66}
              w={850}
              h={100}
              style={{
                color: MAROON,
                fontSize: fs(92),
                lineHeight: 1.05,
                fontFamily: brandFont.style.fontFamily,
              }}
            >
              Baa Baa Shed
            </Box>

            {/* Location icon + Address */}
            <Box x={535} y={176} w={42} h={42} style={{ justifyContent: 'center' }}>
              <svg viewBox="0 0 24 24" style={{ width: '82%', height: '82%' }} aria-hidden="true">
                <path
                  d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"
                  fill="none"
                  stroke={MAROON}
                  strokeWidth="2.1"
                />
              </svg>
            </Box>
            <Box
              x={583}
              y={170}
              w={900}
              h={54}
              style={{
                ...label,
                fontSize: fs(28),
                fontWeight: 700,
                whiteSpace: 'normal',
                overflow: 'hidden',
              }}
            >
              B-9, Rooftop C.G.E.C.H.S, Block 19, Gulistan-e-Johar, Karachi.
            </Box>

            {/* Phone icon + Number */}
            <Box x={535} y={236} w={42} h={42} style={{ justifyContent: 'center' }}>
              <svg viewBox="0 0 24 24" style={{ width: '78%', height: '78%' }} aria-hidden="true">
                <path
                  d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2z"
                  fill="none"
                  stroke={MAROON}
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              </svg>
            </Box>
            <Box x={583} y={232} w={700} h={54} style={{ ...label, fontWeight: 700 }}>
              +92 346 3197358
            </Box>

            {/* S.No / Date / PKR (all within x <= 1975) */}
            <Box
              x={1555}
              y={131}
              w={420}
              h={123}
              style={{ border: dotted, justifyContent: 'center', ...label }}
            >
              S.No. : {receiptNo}
            </Box>
            <Box x={1555} y={325} w={110} h={56} style={{ ...label, fontWeight: 700 }}>
              Date :
            </Box>
            <Box x={1668} y={325} w={307} h={56} style={value}>
              {fmtDate(paymentDate)}
            </Box>
            <Box x={1555} y={389} w={420} h={122} style={{ border: dotted }}>
              <span
                style={{
                  color: INK,
                  fontSize: fs(26),
                  fontWeight: 600,
                  marginLeft: '3%',
                  marginRight: '4%',
                }}
              >
                PKR
              </span>
              <span style={{ color: '#000', fontSize: fs(64), fontWeight: 700 }}>
                {fmt(paymentAmount)}/-
              </span>
            </Box>

            {/* Left details */}
            <Box
              x={240}
              y={325}
              w={320}
              h={56}
              style={{ ...label, fontSize: fs(30), fontWeight: 700, whiteSpace: 'nowrap' }}
            >
              Received From :
            </Box>
            <Box x={580} y={325} w={920} h={56} style={{ ...value, whiteSpace: 'nowrap' }}>
              {clientName}
            </Box>

            <Box x={240} y={425} w={240} h={50} style={{ ...label, fontWeight: 700 }}>
              Amount
            </Box>
            <Box x={240} y={470} w={240} h={30} style={{ color: GREEN, fontSize: fs(20), fontWeight: 600 }}>
              In Words
            </Box>
            <Box x={484} y={425} w={20} h={50} style={label}>
              :
            </Box>
            <Box x={500} y={425} w={1020} h={50} style={value}>
              {amountInWords}
            </Box>

            <Box x={240} y={518} w={240} h={56} style={{ ...label, fontWeight: 700 }}>
              For
            </Box>
            <Box x={484} y={518} w={20} h={56} style={label}>
              :
            </Box>
            <Box x={500} y={518} w={1030} h={56} style={value}>
              Monthly {speciesLabel} Palai Charges for the month of {monthName}
            </Box>
            <Box x={500} y={578} w={900} h={30} style={{ color: GREEN, fontSize: fs(22), fontWeight: 500 }}>
              Animal: {animal.tag_id}
            </Box>

            {/* Balance boxes with chevron block + right chevron separator + value box */}
            {balanceRows.map(([text, amount, y]) => (
              <div key={text}>
                <div
                  style={{
                    ...pos(280, y, 86, 60),
                    background: MAROON,
                    clipPath: 'polygon(0 0, 76% 0, 100% 50%, 76% 100%, 0 100%)',
                    borderRadius: '0.35cqw',
                  }}
                />
                <Box
                  x={362}
                  y={y}
                  w={274}
                  h={60}
                  style={{
                    borderTop: `0.08cqw solid ${MAROON}`,
                    borderBottom: `0.08cqw solid ${MAROON}`,
                    borderLeft: `0.08cqw solid ${MAROON}`,
                    paddingLeft: '1.1%',
                    paddingRight: '0.8%',
                    justifyContent: 'space-between',
                    ...label,
                    fontSize: fs(25),
                  }}
                >
                  <span>{text}</span>
                  <svg
                    viewBox="0 0 16 28"
                    style={{ width: fs(14), height: fs(24), flexShrink: 0 }}
                    aria-hidden="true"
                  >
                    <path
                      d="M3 3L13 14L3 25"
                      fill="none"
                      stroke={MAROON}
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Box>
                <Box
                  x={636}
                  y={y}
                  w={284}
                  h={60}
                  style={{
                    border: `0.08cqw solid ${MAROON}`,
                    justifyContent: 'center',
                    color: '#000',
                    fontSize: fs(38),
                    fontWeight: 500,
                  }}
                >
                  {fmt(amount)}
                </Box>
              </div>
            ))}

            {/* Payment method */}
            <Box x={985} y={635} w={500} h={50} style={{ ...label, fontWeight: 700, fontSize: fs(32) }}>
              Payment Method :
            </Box>
            {methods.map((m, i) => {
              const y = 700 + i * 80
              const checked = method.toLowerCase() === m.toLowerCase()
              return (
                <div key={m}>
                  <Box
                    x={985}
                    y={y}
                    w={48}
                    h={48}
                    style={{
                      border: `0.1cqw solid ${MAROON}`,
                      justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                  >
                    {checked && (
                      <svg
                        viewBox="0 0 24 24"
                        style={{
                          width: '78%',
                          height: '78%',
                          display: 'block',
                        }}
                        aria-hidden="true"
                      >
                        <path
                          d="M4.5 12.5L9.5 17.5L19.5 6.5"
                          fill="none"
                          stroke="#111"
                          strokeWidth="2.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </Box>
                  <Box x={1055} y={y} w={450} h={48} style={{ ...label, fontWeight: 700 }}>
                    {m}
                  </Box>
                </div>
              )
            })}

            {/* Next due + computer generated note */}
            <Box x={1555} y={612} w={420} h={56} style={{ ...label, fontWeight: 700, fontSize: fs(30) }}>
              Next Payment Due Date :
            </Box>
            <Box
              x={1555}
              y={680}
              w={420}
              h={60}
              style={{ ...value, justifyContent: 'center', fontSize: fs(32) }}
            >
              {fmtDate(nextBillingDate, false)}
            </Box>
            <Box
              x={1555}
              y={800}
              w={420}
              h={120}
              style={{
                justifyContent: 'center',
                color: '#64748b',
                fontSize: fs(24),
                fontStyle: 'italic',
                textAlign: 'center',
                lineHeight: 1.3,
                whiteSpace: 'normal',
              }}
            >
              This is a computer generated slip,
              <br />
              signature is not required.
            </Box>
          </div>
        </div>
      </div>
    </div>
  )
}