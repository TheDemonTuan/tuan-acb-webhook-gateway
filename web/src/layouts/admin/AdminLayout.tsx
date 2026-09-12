import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { AdminTopbar } from './AdminTopbar';
import { useBankConnection } from '../../features/bank-connection/BankConnectionProvider';

export const AdminLayout: React.FC = () => {
  const { globalNotice, setGlobalNotice } = useBankConnection();
  const navigate = useNavigate();
  const location = useLocation();

  const currentPath = location.pathname;
  const currentSearch = location.search;

  const isCurrent = (path: string, query?: string) => {
    if (query) {
      return currentPath === path && currentSearch.includes(query);
    }
    return currentPath === path;
  };

  const navTabs = [
    { label: 'Tổng quan', onClick: () => navigate('/admin/overview'), active: isCurrent('/') || isCurrent('/admin') || isCurrent('/admin/overview') },
    { label: 'Kết nối ACB', onClick: () => navigate('/admin/connection'), active: isCurrent('/admin/connection') },
    { label: 'Giao dịch', onClick: () => navigate('/transactions'), active: false },
    { label: 'Webhooks', onClick: () => navigate('/admin/notifications'), active: isCurrent('/admin/notifications') },
    { label: 'Phân phối', onClick: () => navigate('/admin/activity?tab=deliveries'), active: isCurrent('/admin/activity', 'tab=deliveries') },
    { label: 'Polling', onClick: () => navigate('/admin/activity?tab=polling'), active: isCurrent('/admin/activity', 'tab=polling') },
    { label: 'Chẩn đoán', onClick: () => navigate('/admin/system'), active: isCurrent('/admin/system') },
    { label: 'Audit', onClick: () => navigate('/admin/activity?tab=audit'), active: isCurrent('/admin/activity', 'tab=audit') },
  ];

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col font-sans antialiased text-stone-900">
      <AdminTopbar />

      {/* Primary Unified Navigation Bar */}
      <nav className="bg-white border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {navTabs.map((tab) => (
            <button
              key={tab.label}
              type="button"
              role="button"
              onClick={tab.onClick}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 ${
                tab.active
                  ? 'bg-stone-900 text-white shadow-2xs'
                  : tab.label === 'Giao dịch'
                  ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200/60'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-6">
        {globalNotice && (
          <div
            className={`p-4 rounded-xl border text-sm flex items-start gap-3 animate-in fade-in ${
              globalNotice.kind === 'ok'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}
          >
            {globalNotice.kind === 'ok' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 font-medium">{globalNotice.text}</div>
            <button
              type="button"
              onClick={() => setGlobalNotice(null)}
              className="text-xs font-medium text-stone-500 hover:text-stone-800 cursor-pointer"
            >
              Đóng
            </button>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
};
