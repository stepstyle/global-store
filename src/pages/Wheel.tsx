// Prize wheel page — TEST ONLY (route exists only when VITE_WHEEL_MODE=test). Same experience as the first-visit
// popup (components/wheel/WheelExperience): the Worker draws, the page only shows the drawn segment and the conditions.
import React from 'react';
import SEO from '../components/SEO';
import { useCart } from '../App';
import WheelExperience from '../components/wheel/WheelExperience';

export default function Wheel() {
  const { language } = useCart() as any;
  const isAR = language !== 'en';
  return (
    <div className="min-h-screen bg-paper-100 px-4 py-8" data-testid="wheel-page">
      <SEO title={isAR ? 'دولاب الحظ (تجريبي)' : 'Lucky wheel (test)'} description="" />
      <div className="mx-auto max-w-md rounded-4xl border border-ink-100 bg-gradient-to-b from-paper-50 to-ink-50 p-5 shadow-soft sm:p-7">
        <WheelExperience variant="page" />
      </div>
    </div>
  );
}
