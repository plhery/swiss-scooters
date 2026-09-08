'use client';

import Icon from './Icon';
import { useI18n } from '@/lib/i18n';
import { selectionFeedback } from '@/lib/feedback';

export default function MapCredits() {
  const { t } = useI18n();

  return (
    <div className="map-attribution glass">
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
        © OpenStreetMap
      </a>
      <button
        type="button"
        popoverTarget="map-credits"
        aria-label={t('map.credits')}
        onClick={event => {
          event.currentTarget.focus({ preventScroll: true });
          selectionFeedback();
        }}
      >
        <Icon name="info" size={17} />
      </button>
      <section id="map-credits" popover="auto" className="map-credits glass" aria-labelledby="map-credits-title">
        <header>
          <h2 id="map-credits-title">{t('map.credits')}</h2>
          <button type="button" className="text-button" popoverTarget="map-credits" popoverTargetAction="hide" onClick={selectionFeedback}>
            {t('common.done')}
          </button>
        </header>
        <ul>
          <li><a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a></li>
          <li><a href="https://opentransportdata.swiss/en/cookbook/shared-mobility/">Mobility data CH</a></li>
          <li><a href="https://transport.data.gouv.fr/datasets?type=vehicles-sharing">France: Dott, Bird, Lime, Voi, Pony</a></li>
          <li><a href="https://www.mobidata-bw.de/">MobiData BW</a></li>
          <li><a href="https://github.com/MobilityData/gbfs">DE/IT: Dott, Bolt, Hopp, Lime, Voi, Bird</a></li>
          <li><a href="https://www.geo.admin.ch/en/geo-services/geo-services/application-programming-interface-api">© swisstopo</a></li>
          <li><a href="https://data.lillemetropole.fr/">Parking · Métropole Européenne de Lille</a></li>
        </ul>
      </section>
    </div>
  );
}
