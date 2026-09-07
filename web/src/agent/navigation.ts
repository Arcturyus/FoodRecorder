import { create } from 'zustand';
import { todayStr } from '../store/store';

export const AGENT_TABS = ['jour', 'historique', 'stats', 'poids', 'chat', 'aliments', 'nutriments', 'reglages'] as const;
export type AppTab = (typeof AGENT_TABS)[number];

export const AGENT_SECTIONS = [
  'nouvelle-pesee',
  'evolution',
  'pesees',
  'profil',
  'nutriments-ratios',
  'nutriments-reglages',
  'activite-agent',
] as const;
export type AgentSection = (typeof AGENT_SECTIONS)[number];

interface NavigationState {
  tab: AppTab;
  dayDate: string;
  section?: AgentSection;
  nonce: number;
  go: (tab: AppTab, options?: { date?: string; section?: AgentSection }) => void;
  setDayDate: (date: string) => void;
  consumeSection: () => void;
}

export const useNavigation = create<NavigationState>((set) => ({
  tab: 'jour',
  dayDate: todayStr(),
  nonce: 0,
  go: (tab, options) => set((state) => ({
    tab,
    dayDate: options?.date ?? (tab === 'jour' ? todayStr() : state.dayDate),
    section: options?.section,
    nonce: state.nonce + 1,
  })),
  setDayDate: (dayDate) => set({ dayDate }),
  consumeSection: () => set({ section: undefined }),
}));
