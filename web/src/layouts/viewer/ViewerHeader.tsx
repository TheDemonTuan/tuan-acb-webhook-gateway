import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, ArrowRight } from 'lucide-react';
import { ViewerRealtimeStatus } from './ViewerRealtimeStatus';
import { VoiceToggle } from '../../features/voice-announcements/components/VoiceToggle';

export const ViewerHeader: React.FC = () => {
  const navigate = useNavigate();

  return (
    <header className="bg-white border-b border-stone-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/transactions" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-lg shadow-sm group-hover:bg-emerald-700 transition">
              A
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-bold text-stone-900 leading-tight">
                ACB Transaction Webhook
              </h1>
              <span className="text-[11px] font-medium text-stone-500 block">
                Cổng theo dõi giao dịch thời gian thực
              </span>
            </div>
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:block">
            <ViewerRealtimeStatus />
          </div>
          <VoiceToggle />
          <button
            type="button"
            role="button"
            onClick={() => navigate('/admin')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-stone-900 text-white hover:bg-stone-800 transition shadow-xs cursor-pointer"
          >
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>Quản trị hệ thống</span>
            <ArrowRight className="w-3 h-3 text-stone-400" />
          </button>
        </div>
      </div>
    </header>
  );
};
