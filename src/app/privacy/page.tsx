import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy — Swiss Scooters',
  description: 'How Swiss Scooters handles location, search, and service data.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <article className="legal-content">
        <Link className="legal-back" href="/">← Back to Swiss Scooters</Link>
        <h1>Privacy</h1>
        <p>Last updated: 23 August 2026</p>

        <h2>Overview</h2>
        <p>
          Swiss Scooters has no user accounts, advertising, analytics SDK, or application
          database. It does not intentionally retain your precise location or address searches.
        </p>

        <h2>Location and map requests</h2>
        <p>
          If you grant location permission, your browser or device provides your position to the
          app. Your position is used on the device to focus the map and calculate distances. The
          Swiss Scooters API receives the visible map bounds needed to find vehicles, but no
          separate user-location coordinate. These values are not stored by the application.
        </p>
        <p>
          Map tiles are requested directly from OpenStreetMap or CARTO. Those providers receive
          standard network information such as your IP address and the requested tile coordinates.
        </p>

        <h2>Address search</h2>
        <p>
          Address search text is sent through the Swiss Scooters API to the Swiss federal
          geo.admin.ch service operated by swisstopo. The current app sends search text in the
          request body, and instructs browsers and intermediary caches not to store the request
          or response.
        </p>

        <h2>Mobility data</h2>
        <p>
          Live vehicle data comes from the Open data platform mobility Switzerland and participating
          mobility providers. Swiss Scooters filters that data to the visible map area and does not
          build a history of vehicle movements.
        </p>

        <h2>Local storage and service worker</h2>
        <p>
          Map style, language, and battery filter are stored locally on your device. Precise map
          origins are not persisted. A service worker caches the application shell and static
          assets for faster and offline launches. You can remove this data through your browser
          or by deleting the app.
        </p>

        <h2>Infrastructure logs</h2>
        <p>
          Cloudflare processes requests to host and protect the service. Persisted Worker invocation
          logs are disabled so full request URLs containing coordinates or searches are not stored
          in the application&apos;s log stream. Cloudflare may still process limited network and security
          metadata under its own policies. Application error logs contain event names and error
          messages, not precise locations or search text.
        </p>

        <h2>Contact and third parties</h2>
        <p>
          Questions can be sent to <a href="mailto:swiss-scooters@plhery.com">swiss-scooters@plhery.com</a>.
          Third-party services have their own privacy policies: {' '}
          <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare</a>, {' '}
          <a href="https://osmfoundation.org/wiki/Privacy_Policy">OpenStreetMap</a>, {' '}
          <a href="https://carto.com/privacy/">CARTO</a>, and {' '}
          <a href="https://www.geo.admin.ch/en/data-privacy">geo.admin.ch</a>.
        </p>
      </article>
    </main>
  );
}
