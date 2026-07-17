import { BRANDS, lastBrand, type BrandId } from '../brand/brand'
import { useAuth } from '../auth/AuthContext'

export function BrandPicker({ onPick }: { onPick: (b: BrandId) => void }) {
  const { user, logout } = useAuth()
  const last = lastBrand()

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-red-50 to-orange-50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h1 className="text-center text-xl font-bold text-slate-800">เลือกแบรนด์ที่จะจัดการ</h1>
        <p className="mb-5 mt-1 text-center text-sm text-slate-500">
          สวัสดี {user?.name} — ข้อมูลสต๊อกของแต่ละแบรนด์แยกกันสมบูรณ์
        </p>
        <div className="space-y-3">
          {BRANDS.map((b) => (
            <button
              key={b.id}
              onClick={() => onPick(b.id)}
              className={`flex w-full items-center gap-4 rounded-xl border-2 p-4 text-left transition-colors hover:border-red-400 hover:bg-red-50 ${
                b.id === last ? 'border-red-300 bg-red-50/40' : 'border-slate-200'
              }`}
            >
              <span className="text-4xl">{b.emoji}</span>
              <div className="min-w-0">
                <div className="font-semibold text-slate-800">{b.name}</div>
                <div className="text-xs text-slate-400">
                  {b.id === 'pizza' ? 'ระบบสต๊อกพิซซ่า' : 'ระบบสต๊อกแซนด์วิช (แบรนด์น้อง)'}
                </div>
              </div>
              {b.id === last && <span className="ml-auto text-xs font-medium text-red-500">ล่าสุด</span>}
            </button>
          ))}
        </div>
        <button
          onClick={logout}
          className="mx-auto mt-5 block text-xs text-slate-400 hover:text-slate-600 hover:underline"
        >
          ออกจากระบบ
        </button>
      </div>
    </div>
  )
}
