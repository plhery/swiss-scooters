const NOT_A_PAGE = /^\/(?:api|_next|cdn-cgi)\//;
const FILE = /\.[a-z0-9]+$/i;

/**
 * The request to render a page with: the same for every link to that page.
 *
 * The browser reads a link's parameters (the origin, the filters, the
 * appearance) itself. The server would write them into the page, and it
 * shares one render between requests for the same page that arrive together:
 * a visitor could be handed the page rendered for someone else's link, with
 * that link's coordinates in it. The service worker would also take every
 * link for a new version of the app, and reload.
 */
export function pageRequest(request: Request): Request {
  if (request.method !== 'GET' && request.method !== 'HEAD') return request;
  // The router's own requests come with a parameter that the server checks.
  if (request.headers.has('rsc')) return request;

  const url = new URL(request.url);
  if (!url.search || NOT_A_PAGE.test(url.pathname) || FILE.test(url.pathname)) return request;

  url.search = '';
  return new Request(url, request);
}
