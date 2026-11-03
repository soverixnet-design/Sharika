/* LIVE mode requires your own adapter. No automatic fallback to demo. */
window.SHARIKA_CONFIG = {
  mode: 'demo', // 'live' for production integration
  compact: false,
  demoRoundMs: 20000,
  currencyLabel: 'Practice credits',
  // Called by host code when the user changes room layout, never joins/leaves voice.
  onLayoutChange: null
};
