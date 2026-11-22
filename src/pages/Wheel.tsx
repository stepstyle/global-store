// Prize wheel page — the route exists only in a wheel build (VITE_WHEEL_MODE=test, or =live for the approved production
// campaign). Same experience as the first-visit popup (components/wheel/WheelExperience): the Worker draws, the page only
// shows the drawn segment and the conditions. No open campaign -> the page is not shown: the visitor goes to the home page.
import React, { useCallback } from 'react';
import * as ReactRouterDOM from 'react-router-dom';
import SEO from '../components/SEO';
import { useCart } from '../App';
import WheelExperience from '../components/wheel/WheelExperience';
import { WHEEL_TEST_BUILD } from '../services/wheel';

const { useNavigate } = ReactRouterDOM as any;

export default function Wheel() {
  const { language } = useCart() as any;
  const isAR = language !== 'en';
  const navigate = useNavigate();
  const onClosed = useCallback(() => navigate('/', { replace: true }), [navigate]);
  const title = isAR ? 'دولاب الحظ' : 'Lucky wheel';
  return (
    <div className="min-h-screen bg-paper-100 px-4 py-8" data-testid="wheel-page">
      <SEO title={WHEEL_TEST_BUILD ? `${title} (${isAR ? 'تجريبي' : 'test'})` : title} description="" />
      <div className="mx-auto max-w-md rounded-4xl border border-ink-100 bg-gradient-to-b from-paper-50 to-ink-50 p-5 shadow-soft sm:p-7">
        <WheelExperience variant="page" onClosed={onClosed} />
      </div>
    </div>
  );
}
