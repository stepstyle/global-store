// Mock Google Analytics Service

export const trackPageView = (path: string) => {
  // In a real app, this would be: ga('send', 'pageview', path);
  console.log(`[Analytics] Page View: ${path}`);
};

export const trackEvent = (category: string, action: string, label?: string) => {
  // In a real app, this would be: ga('send', 'event', category, action, label);
  console.log(`[Analytics] Event: ${category} - ${action} ${label ? `(${label})` : ''}`);
};
