/**
 * Runs while the page is parsed, before the first paint and long before the
 * app itself starts: a chosen Light or Dark appearance is put on the app's
 * frame at once, so that the page does not first show in the appearance of the
 * system. Automatic needs nothing, the stylesheet follows the system by itself.
 *
 * It reads what readUrlParams() in src/app/page.tsx reads, in the same order:
 * the link when it has parameters, the saved settings otherwise, and "tile=dark"
 * from before appearance and map style were separate. The test keeps the two
 * in step. Written as text because it is not part of any bundle; the Worker
 * gives it the nonce of the response like every other script of the page.
 */
export const FIRST_PAINT_THEME_SCRIPT = `(function () {
  try {
    var shell = document.querySelector('.app-shell');
    if (!shell) return;
    var link = new URLSearchParams(location.search);
    var read = function (key) { return link.get(key); };
    if (!link.toString()) {
      var saved = JSON.parse(localStorage.getItem('scooters-params') || 'null');
      if (!saved || typeof saved !== 'object') return;
      read = function (key) { return typeof saved[key] === 'string' ? saved[key] : null; };
    }
    var theme = read('theme');
    if (theme !== 'light' && theme !== 'dark' && theme !== 'auto') theme = read('tile') === 'dark' ? 'dark' : null;
    if (theme === 'light' || theme === 'dark') shell.setAttribute('data-theme', theme);
  } catch (error) {}
})();`;
