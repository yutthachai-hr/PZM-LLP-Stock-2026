import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { BrandProvider, useBrand } from './brand/BrandContext'
import { DataProvider } from './data/DataContext'
import { SupplierIntelProvider } from './data/useSupplierIntel'
import { ToastProvider } from './components/Toast'
import { ConfirmProvider } from './components/Confirm'
import { I18nProvider, useT } from './i18n/I18nContext'
import { Spinner } from './components/ui'
import { UpdateBanner } from './pwa/UpdateBanner'
import { DemoBanner } from './components/DemoBanner'
import { Layout } from './components/Layout'
import { BrandPicker } from './components/BrandPicker'
import { brandToResume } from './share/liffResume'
import { LoginPage } from './pages/Login'
import { DashboardPage } from './pages/Dashboard'
import { ensureBrandLocations } from './services/seed'

// Every page but the two a session starts on loads when first opened (plan D1'): the
// first paint no longer carries Excel, PDF, charts and thirty screens nobody has asked for.
// A chunk that fails to load (a deploy replaced it) is caught by the page's ErrorBoundary,
// which offers a reload.
const ProductsPage = lazy(() => import('./pages/Products').then((m) => ({ default: m.ProductsPage })))
const StockCardPage = lazy(() => import('./pages/StockCardPage').then((m) => ({ default: m.StockCardPage })))
const ReceivePage = lazy(() => import('./pages/Receive').then((m) => ({ default: m.ReceivePage })))
const IssuePage = lazy(() => import('./pages/Issue').then((m) => ({ default: m.IssuePage })))
const AdjustPage = lazy(() => import('./pages/Adjust').then((m) => ({ default: m.AdjustPage })))
const MonthlyCountsPage = lazy(() => import('./pages/counts/MonthlyCountsPage').then((m) => ({ default: m.MonthlyCountsPage })))
const MonthlyCountSheet = lazy(() => import('./pages/counts/MonthlyCountSheet').then((m) => ({ default: m.MonthlyCountSheet })))
const MovementsPage = lazy(() => import('./pages/Movements').then((m) => ({ default: m.MovementsPage })))
const ReportsPage = lazy(() => import('./pages/Reports').then((m) => ({ default: m.ReportsPage })))
const ImportPage = lazy(() => import('./pages/Import').then((m) => ({ default: m.ImportPage })))
const SuppliersPage = lazy(() => import('./pages/Suppliers').then((m) => ({ default: m.SuppliersPage })))
const SupplierPerformancePage = lazy(() => import('./pages/suppliers/SupplierPerformance').then((m) => ({ default: m.SupplierPerformancePage })))
const OrdersPage = lazy(() => import('./pages/Orders').then((m) => ({ default: m.OrdersPage })))
const InboxPage = lazy(() => import('./pages/Inbox').then((m) => ({ default: m.InboxPage })))
const PurchaseBatchesPage = lazy(() => import('./pages/purchase/PurchaseBatches').then((m) => ({ default: m.PurchaseBatchesPage })))
const PurchaseBatchReviewPage = lazy(() => import('./pages/purchase/PurchaseBatchReview').then((m) => ({ default: m.PurchaseBatchReviewPage })))
const PurchaseRequestsPage = lazy(() => import('./pages/requests/PurchaseRequests').then((m) => ({ default: m.PurchaseRequestsPage })))
const RequestPage = lazy(() => import('./pages/requests/RequestPage').then((m) => ({ default: m.RequestPage })))
const CalendarPage = lazy(() => import('./pages/calendar/CalendarPage').then((m) => ({ default: m.CalendarPage })))
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })))
const AnnouncementsPage = lazy(() => import('./pages/announcements/AnnouncementsPage').then((m) => ({ default: m.AnnouncementsPage })))
const AnnouncementPage = lazy(() => import('./pages/announcements/AnnouncementPage').then((m) => ({ default: m.AnnouncementPage })))
const TransfersPage = lazy(() => import('./pages/transfers/TransfersPage').then((m) => ({ default: m.TransfersPage })))
const TransferDetailPage = lazy(() => import('./pages/transfers/TransferDetailPage').then((m) => ({ default: m.TransferDetailPage })))
const TransferReceivePage = lazy(() => import('./pages/transfers/TransferReceivePage').then((m) => ({ default: m.TransferReceivePage })))
const TransfersTodayPage = lazy(() => import('./pages/transfers/TransfersTodayPage').then((m) => ({ default: m.TransfersTodayPage })))
const RecipesPage = lazy(() => import('./pages/recipes/RecipesPage').then((m) => ({ default: m.RecipesPage })))
const MorePage = lazy(() => import('./pages/More').then((m) => ({ default: m.MorePage })))
// Ask PZM: staging builds only (VITE_ASK_PZM=on). Elsewhere the route does not exist at all.
const ASK_PZM_ON = import.meta.env.VITE_ASK_PZM === 'on'
const AskPzmPage = lazy(() => import('./pages/AskPzm').then((m) => ({ default: m.AskPzmPage })))

function Gate() {
  const { user, loading } = useAuth()
  const { brand, choose, reset } = useBrand()
  const t = useT()

  // reset the brand choice on logout so the picker shows again next login
  useEffect(() => {
    if (!loading && !user) reset()
  }, [loading, user, reset])

  // A send picked up after a trip through LINE says which brand its order belongs to, so
  // it opens that one and lands on the sheet. Every other visit still starts at the picker
  // (share/liffResume.ts).
  useEffect(() => {
    if (!user || brand) return
    const wanted = brandToResume()
    if (wanted) choose(wanted)
  }, [user, brand, choose])

  // Make sure the chosen brand has its default locations.
  //
  // Admins only: creating a location is an admin write, so running this for staff produced
  // a permission error on every sign-in that was then swallowed, hiding real failures along
  // with it. Staff arriving at a brand with no locations see an empty screen, which is
  // correct — an admin has to set the warehouse up.
  useEffect(() => {
    if (user?.role !== 'admin' || !brand) return
    ensureBrandLocations(brand).catch((e) => {
      console.error('[app] could not create the default locations', e)
    })
  }, [user, brand])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner label={t('กำลังโหลด...')} />
      </div>
    )
  }
  if (!user) return <LoginPage />
  if (!brand) return <BrandPicker onPick={choose} />

  return (
    <DataProvider key={brand}>
      <SupplierIntelProvider>
        <Layout>
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/products/:id/card" element={<StockCardPage />} />
              <Route path="/receive" element={<ReceivePage />} />
              <Route path="/issue" element={<IssuePage />} />
              <Route path="/recipes" element={<RecipesPage />} />
              <Route path="/transfers" element={<TransfersPage />} />
              <Route path="/transfers/today" element={<TransfersTodayPage />} />
              <Route path="/transfers/new" element={<TransferDetailPage />} />
              <Route path="/transfers/:id/receive" element={<TransferReceivePage />} />
              <Route path="/transfers/:id" element={<TransferDetailPage />} />
              <Route path="/adjust" element={<AdjustPage />} />
              <Route path="/counts" element={<MonthlyCountsPage />} />
              <Route path="/counts/:id" element={<MonthlyCountSheet />} />
              <Route path="/movements" element={<MovementsPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/suppliers" element={<SuppliersPage />} />
              <Route path="/suppliers/performance" element={<SupplierPerformancePage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/inbox" element={<InboxPage />} />
              <Route path="/requests" element={<PurchaseRequestsPage />} />
              <Route path="/requests/:id" element={<RequestPage />} />
              <Route path="/purchase" element={<PurchaseBatchesPage />} />
              {/* D4′: Excel purchasing is a purchase-request intake now, not a batch of its own. */}
              <Route path="/purchase/import" element={<Navigate to="/requests/new?import=1" replace />} />
              <Route path="/purchase/:id" element={<PurchaseBatchReviewPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/announcements" element={<AnnouncementsPage />} />
              <Route path="/announcements/new" element={<AnnouncementPage />} />
              <Route path="/announcements/:company/:id" element={<AnnouncementPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/:section" element={<SettingsPage />} />
              <Route path="/more" element={<MorePage />} />
              {ASK_PZM_ON && <Route path="/ask" element={<AskPzmPage />} />}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Layout>
      </SupplierIntelProvider>
    </DataProvider>
  )
}

export function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <BrandProvider>
              <BrowserRouter>
                <Gate />
                {/* Outside Gate on purpose: a device parked on the sign-in screen is
                    exactly the one nobody thinks to reload. */}
                <UpdateBanner />
                {/* Outside Gate too — the sign-in screen is the first thing anyone being
                    shown the demo sees, and it is already a convincing one. */}
                <DemoBanner />
              </BrowserRouter>
            </BrandProvider>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </I18nProvider>
  )
}

export default App
