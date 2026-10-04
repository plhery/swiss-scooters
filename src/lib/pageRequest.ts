const NOT_A_PAGE = /^\/(?:api|_next|cdn-cgi)\//;
const FILE = /\.[a-z0-9]+$/i;
const ROUTER_PARAMETER = '_rsc';

/**
 * The request to render a page with: the same for every link to that page.
 *
 * The browser reads a link's parameters (the origin, the filters, the
 * appearance) itself. The server would write them into the page, and it
 * shares one render between requests for the same page that arrive together:
 * a visitor could be handed the page rendered for someone else's link, with
 * that link's coordinates in it. The service worker would also take every
 * link for a new version of the app, and reload.
 *
 * The pages are served as they were built (open-next.config.ts), so nothing
 * should be rendered per request at all; this is the second guard.
 */
export function pageRequest(request: Request): Request {
  if (request.method !== 'GET' && request.method !== 'HEAD') return request;

  const url = new URL(request.url);
  if (!url.search || NOT_A_PAGE.test(url.pathname) || FILE.test(url.pathname)) return request;

  // The router's own requests come with one parameter that the server checks.
  // Only that one stays: anyone can send the header beside any other parameter.
  const checked = request.headers.has('rsc') ? url.searchParams.get(ROUTER_PARAMETER) : null;
  const search = checked === null ? '' : `?${new URLSearchParams({ [ROUTER_PARAMETER]: checked })}`;
  if (url.search === search) return request;

  url.search = search;
  return new Request(url, request);
}
