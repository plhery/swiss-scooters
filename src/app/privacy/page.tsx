import AnalyticsPreference from '@/components/AnalyticsPreference';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy — Scooters',
  description: 'How Scooters handles location, search, and service data.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <article className="legal-content">
        <Link className="legal-back" href="/">← Back to Scooters</Link>
        <h1>Privacy</h1>
        <p>Last updated: 8 September 2026</p>

        <h2>Overview</h2>
        <p>
          Scooters has no user accounts or advertising. It does not intentionally retain your precise location or address searches.
        </p>

        <h2>Location and map requests</h2>
        <p>
          If you grant location permission, your browser or device provides your position to the
          app. Your position is used on the device to focus the map and calculate distances. The
          Scooters API receives the visible map bounds needed to find vehicles, but no
          separate user-location coordinate. These values are not stored by the application.
        </p>
        <p>
          Map tiles are requested directly from OpenStreetMap. It receives standard network
          information such as your IP address, the website origin and the requested tile coordinates.
        </p>

        <h2>Address search</h2>
        <p>
          Address search text is sent through the Scooters API to the Swiss federal
          geo.admin.ch service operated by swisstopo. The current app sends search text in the
          request body, and instructs browsers and intermediary caches not to store the request
          or response.
        </p>

        <h2>Mobility data</h2>
        <p>
          Live vehicle data comes from the Open data platform mobility Switzerland and participating
          mobility providers. Scooters filters that data to the visible map area and does not
          build a history of vehicle movements.
        </p>

        <h2>Usage analytics</h2>
        <p>
          The public website and iOS app send page or screen views and actions to our
          self-hosted Umami service at u.plhery.com. These include searches (only result counts),
          filters, map selections, directions and rental button taps, settings changes, and
          generic error outcomes. Events distinguish web, installed web app, and iOS usage.
          Rental taps do not tell us whether you actually rented a vehicle.
        </p>
        <p>
          Analytics never includes address text, precise coordinates, vehicle identifiers,
          full URLs, or advertising identifiers. Umami processes your IP address and user agent
          to derive approximate location, device information, and short-lived session statistics.
          It does not store raw IP addresses. We use no analytics cookies or persistent user IDs,
          and do not record your screen or replay sessions.
        </p>
        <p>
          You can disable usage analytics below, or in the iOS app&apos;s Settings.
          The website also respects Do Not Track and Global Privacy Control. This browser
          preference is saved locally and does not affect your iOS setting.
        </p>
        <p><AnalyticsPreference /></p>

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
          <a href="https://osmfoundation.org/wiki/Privacy_Policy">OpenStreetMap</a>, and {' '}
          <a href="https://www.geo.admin.ch/en/data-privacy">geo.admin.ch</a>.
        </p>
      </article>
    </main>
  );
}
