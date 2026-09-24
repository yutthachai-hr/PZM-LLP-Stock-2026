import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { BrandProvider, useBrand } from './brand/BrandContext'
import { DataProvider } from './data/DataContext'
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
import { ProductsPage } from './pages/Products'
import { StockCardPage } from './pages/StockCardPage'
import { ReceivePage } from './pages/Receive'
import { IssuePage } from './pages/Issue'
import { AdjustPage } from './pages/Adjust'
import { MovementsPage } from './pages/Movements'
import { ReportsPage } from './pages/Reports'
import { ImportPage } from './pages/Import'
import { SuppliersPage } from './pages/Suppliers'
import { OrdersPage } from './pages/Orders'
import { PurchaseBatchesPage } from './pages/purchase/PurchaseBatches'
import { PurchaseImportPage } from './pages/purchase/PurchaseImport'
import { PurchaseBatchReviewPage } from './pages/purchase/PurchaseBatchReview'
import { PurchaseRequestsPage } from './pages/requests/PurchaseRequests'
import { RequestPage } from './pages/requests/RequestPage'
import { CalendarPage } from './pages/calendar/CalendarPage'
import { SettingsPage } from './pages/Settings'
import { AnnouncementsPage } from './pages/announcements/AnnouncementsPage'
import { AnnouncementPage } from './pages/announcements/AnnouncementPage'
import { TransfersPage } from './pages/transfers/TransfersPage'
import { TransferDetailPage } from './pages/transfers/TransferDetailPage'
import { TransferReceivePage } from './pages/transfers/TransferReceivePage'
import { TransfersTodayPage } from './pages/transfers/TransfersTodayPage'
import { MorePage } from './pages/More'
import { ensureBrandLocations } from './services/seed'

function Gate() {
  const { user, loading } = useAuth()
  const { brand, choose, reset } = useBrand()
  const t = useT()

  // reset the brand choice on logout so the picker shows again next login
  useEffect(() => {
    if (!user) reset()
  }, [user, reset])

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
      <Layout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/:id/card" element={<StockCardPage />} />
          <Route path="/receive" element={<ReceivePage />} />
          <Route path="/issue" element={<IssuePage />} />
          <Route path="/transfers" element={<TransfersPage />} />
          <Route path="/transfers/today" element={<TransfersTodayPage />} />
          <Route path="/transfers/new" element={<TransferDetailPage />} />
          <Route path="/transfers/:id/receive" element={<TransferReceivePage />} />
          <Route path="/transfers/:id" element={<TransferDetailPage />} />
          <Route path="/adjust" element={<AdjustPage />} />
          <Route path="/movements" element={<MovementsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/requests" element={<PurchaseRequestsPage />} />
          <Route path="/requests/:id" element={<RequestPage />} />
          <Route path="/purchase" element={<PurchaseBatchesPage />} />
          <Route path="/purchase/import" element={<PurchaseImportPage />} />
          <Route path="/purchase/:id" element={<PurchaseBatchReviewPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route path="/announcements/new" element={<AnnouncementPage />} />
          <Route path="/announcements/:company/:id" element={<AnnouncementPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/:section" element={<SettingsPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
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
