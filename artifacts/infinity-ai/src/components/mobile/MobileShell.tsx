/**
 * MobileShell — Mobile-first application shell
 * Different website for the same goal: full-screen views, bottom nav,
 * swipe gestures between views, pull-to-refresh on list views.
 */

import React, { useState, useCallback, useEffect } from "react";
import { useLocation, useRoute } from "wouter";
import { BottomNav, type BottomNavItem } from "@/components/mobile/BottomNav";
import { SwipeableArea } from "@/components/mobile/SwipeGesture";
import { haptics } from "@/lib/haptics";
import { useI18n, type TranslationKey } from "@/lib/i18n";

export type MobileView = 'chat' | 'build' | 'terminal' | 'projects' | 'settings';

export interface MobileShellProps {
  children: React.ReactNode;
  activeView: MobileView;
  onNavigate: (view: MobileView) => void;
}

const VIEW_ORDER: MobileView[] = ['chat', 'build', 'terminal', 'projects', 'settings'];

export const MobileShell: React.FC<MobileShellProps> = ({
  children,
  activeView,
  onNavigate,
}) => {
  const { t } = useI18n();

  const bottomNavItems: BottomNavItem[] = [
    {
      id: 'chat',
      label: t('nav.chat'),
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      id: 'build',
      label: t('nav.build'),
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      ),
    },
    {
      id: 'terminal',
      label: t('nav.terminal'),
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      ),
    },
    {
      id: 'projects',
      label: t('nav.projects'),
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      id: 'settings',
      label: t('nav.settings'),
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      ),
    },
  ];

  const handleSwipe = useCallback((direction: 'left' | 'right') => {
    const idx = VIEW_ORDER.indexOf(activeView);
    if (direction === 'left' && idx < VIEW_ORDER.length - 1) {
      onNavigate(VIEW_ORDER[idx + 1]);
    } else if (direction === 'right' && idx > 0) {
      onNavigate(VIEW_ORDER[idx - 1]);
    }
  }, [activeView, onNavigate]);

  return (
    <div className="h-dvh flex flex-col bg-background text-foreground overflow-hidden">
      {/* Swipeable content area */}
      <SwipeableArea
        options={{
          threshold: 80,
          minVelocity: 0.2,
          horizontal: true,
          vertical: false,
          onSwipeEnd: (direction) => {
            if (direction === 'left' || direction === 'right') {
              handleSwipe(direction);
            }
          },
        }}
        className="flex-1 min-h-0"
      >
        <div className="h-full overflow-hidden">
          {children}
        </div>
      </SwipeableArea>

      {/* Bottom navigation */}
      <BottomNav
        items={bottomNavItems}
        activeId={activeView}
        onChange={(id) => onNavigate(id as MobileView)}
      />
    </div>
  );
};

export default MobileShell;
