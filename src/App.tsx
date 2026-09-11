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
import { LoginPage } from './pages/Login'
import { DashboardPage } from './pages/Dashboard'
import { ProductsPage } from './pages/Products'
import { ReceivePage } from './pages/Receive'
import { IssuePage } from './pages/Issue'
import { AdjustPage } from './pages/Adjust'
import { MovementsPage } from './pages/Movements'
import { ReportsPage } from './pages/Reports'
import { ImportPage } from './pages/Import'
import { NotesPage } from './pages/Notes'
import { SettingsPage } from './pages/Settings'
import { ensureBrandLocations } from './services/seed'

function Gate() {
  const { user, loading } = useAuth()
  const { brand, choose, reset } = useBrand()
  const t = useT()

  // reset the brand choice on logout so the picker shows again next login
  useEffect(() => {
    if (!user) reset()
  }, [user, reset])

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
          <Route path="/receive" element={<ReceivePage />} />
          <Route path="/issue" element={<IssuePage />} />
          <Route path="/adjust" element={<AdjustPage />} />
          <Route path="/movements" element={<MovementsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
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
