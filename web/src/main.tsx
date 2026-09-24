const params = new URLSearchParams(window.location.search);

if (params.get('foodrecorderWorker') === '1') {
  void import('./backgroundWorker').then(({ startBackgroundWorker }) => startBackgroundWorker());
} else {
  void import('./appEntry');
}
