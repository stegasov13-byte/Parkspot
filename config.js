// Public configuration only. Never put PINs, API keys, or bridge secrets here.
window.PARKSPOT_PAGES_CONFIG = Object.freeze({
  // After deploying the Cloud Run gateway, replace this with its HTTPS URL.
  apiBaseUrl: 'https://REPLACE-WITH-CLOUD-RUN-URL',
  appName: 'ParkSpot Memmingen',
  language: 'de'
});
