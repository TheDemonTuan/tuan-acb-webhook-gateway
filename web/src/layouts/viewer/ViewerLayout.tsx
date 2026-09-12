import React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { ViewerHeader } from './ViewerHeader';

export const ViewerLayout: React.FC = () => {
  const navigate = useNavigate();

  const navTabs = [
    { label: 'Tổng quan', onClick: () => navigate('/admin/overview'), active: false },
    { label: 'Kết nối ACB', onClick: () => navigate('/admin/connection'), active: false },
    { label: 'Giao dịch', onClick: () => navigate('/transactions'), active: true },
    { label: 'Webhooks', onClick: () => navigate('/admin/notifications'), active: false },
    { label: 'Phân phối', onClick: () => navigate('/admin/activity?tab=deliveries'), active: false },
    { label: 'Polling', onClick: () => navigate('/admin/activity?tab=polling'), active: false },
    { label: 'Chẩn đoán', onClick: () => navigate('/admin/system'), active: false },
    { label: 'Audit', onClick: () => navigate('/admin/activity?tab=audit'), active: false },
  ];

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 flex flex-col font-sans antialiased">
      <ViewerHeader />

      {/* Navigation Sub-bar */}
      <nav className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {navTabs.map((tab) => (
            <button
              key={tab.label}
              type="button"
              role="button"
              onClick={tab.onClick}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer shrink-0 ${
                tab.active
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <Outlet />
      </main>
      <footer className="py-6 border-t border-stone-200 text-center text-xs text-stone-600">
        ACB Transaction Webhook Gateway &copy; 2026. Tất cả dữ liệu được bảo vệ và đồng bộ trực tiếp qua SSE.
      </footer>
    </div>
  );
};
