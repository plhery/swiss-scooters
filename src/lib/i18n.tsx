'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const SUPPORTED_LOCALES = ['de', 'fr', 'it', 'en'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

const en = {
    "common.done": "Done",
    "search.chooseOrigin": "Choose an origin",
    "search.currentLocation": "Current location",
    "search.change": "Search or change origin",
    "search.changeOrigin": "Origin: {name}. Search or change origin.",
    "search.nearby": "Search nearby",
    "settings.more": "More options",
    "providers.title": "Providers",
    "sheet.scooterOnMap": "scooter on map",
    "sheet.scootersOnMap": "scooters on map",
    "marker.walk": "walk",
    "parking.label": "{name} parking: {place}",
    "parking.required": "Designated parking is required in this zone.",
    "parking.designated": "Designated scooter parking.",
    "parking.check": "Check the operator app to confirm you can end your ride here.",
    "parking.directions": "Directions to parking",
    "parking.unavailable": "Parking data is temporarily unavailable",
    "parking.stale": "Parking data may be out of date",
  'controls.locate': 'Go to my location',
  'controls.refresh': 'Refresh scooters',
  'controls.zoomGroup': 'Map zoom',
  'controls.zoomIn': 'Zoom in',
  'controls.zoomOut': 'Zoom out',
  'intro.title': 'Find a scooter nearby',
  'intro.body': 'See scooters near you and how far away they are.',
  'intro.useLocation': 'Use my location',
  'intro.browse': 'Browse the map',
  'sheet.region': 'Scooter search controls',
  'sheet.expand': 'Expand controls',
  'sheet.collapse': 'Collapse controls',
  'sheet.updating': 'Updating…',
  'sheet.finding': 'Finding scooters…',
  'sheet.updated': 'Updated {time}',
  'sheet.justNow': 'Just now',
  'sheet.minutesAgo': '{count}m ago',
  'sheet.onMap': 'on this map',
  'sheet.scooter': 'scooter',
  'sheet.scooters': 'scooters',
  'providers.filter': 'Filter scooters by provider',
  'providers.all': 'All',
  'providers.allLabel': 'All providers, {count}. Show all.',
  'providers.showAll': 'Show all providers',
  'providers.toggleLabel': '{name}, {count}. {state}.',
  'providers.selected': 'Shown',
  'providers.notSelected': 'Hidden',
  'filters.title': 'Filters',
  'filters.minBattery': 'Min. battery',
  'filters.any': 'Any',
  'filters.reset': 'Reset filters',
  'filters.active': 'Filters active',
  'filters.unknownBattery': 'Scooters without battery data are hidden.',
  'settings.title': 'Settings & map',
  'map.style': 'Map style',
  'map.light': 'Light',
  'map.dark': 'Dark',
  'map.osm': 'OSM',
    'map.credits': 'Map & data credits',
  'language.title': 'Language',
  'status.updatingLocation': 'Updating location…',
  'status.refreshed': 'Scooters refreshed',
  'status.retry': 'Retry',
  'errors.fetchScooters': 'Unable to load scooters',
  'errors.locationDenied': 'Location access is off. You can still search or browse the map.',
  'errors.locationUnavailable': 'Your location is temporarily unavailable. Please try again.',
  'data.overview': 'City totals · refreshed hourly',
  'data.cached': 'Showing cached data',
  'data.partial': 'Some providers unavailable',
  'data.truncated': 'Showing {shown} of {total} results',
  'marker.scooter': '{name} scooter',
  'marker.scooterAway': '{name} scooter, {distance} away',
  'marker.walkThere': 'Walk there',
  'marker.openIn': 'Open in {name}',
  'marker.app': 'app',
  'marker.close': 'Close scooter details',
  'marker.cluster': '{count} scooters: {providers}. Zoom in to separate.',
  'marker.yourLocation': 'Your live location',
  'marker.searchedAddress': 'Searched address: {name}',
  'distance.meters': '{count} m',
  'distance.kilometers': '{count} km',
  'search.title': 'Address search',
  'search.placeholder': 'City or Swiss address',
  'search.clear': 'Clear address search',
  'search.loading': 'Searching…',
  'search.noResults': 'No addresses or cities found',
  'search.error': 'Address search is unavailable',
  'search.results': 'Address suggestions',
  'empty.filtered': 'No scooters match these filters here.',
  'empty.area': 'No scooters on this part of the map.',
  'links.privacy': 'Privacy',
} as const;

export type TranslationKey = keyof typeof en;
type Dictionary = Record<TranslationKey, string>;

const dictionaries: Record<AppLocale, Dictionary> = {
  en,
  de: {
    "common.done": "Fertig",
    "search.chooseOrigin": "Startpunkt wählen",
    "search.currentLocation": "Aktueller Standort",
    "search.change": "Startpunkt suchen oder ändern",
    "search.changeOrigin": "Startpunkt: {name}. Startpunkt suchen oder ändern.",
    "search.nearby": "In der Nähe suchen",
    "settings.more": "Weitere Optionen",
    "providers.title": "Anbieter",
    "sheet.scooterOnMap": "Scooter auf der Karte",
    "sheet.scootersOnMap": "Scooter auf der Karte",
    "marker.walk": "zu Fuss",
    "parking.label": "{name}-Parkplatz: {place}",
    "parking.required": "In dieser Zone muss auf ausgewiesenen Flächen geparkt werden.",
    "parking.designated": "Ausgewiesener Rollerparkplatz.",
    "parking.check": "Prüfe in der Anbieter-App, ob du die Fahrt hier beenden kannst.",
    "parking.directions": "Weg zum Parkplatz",
    "parking.unavailable": "Parkplatzdaten sind vorübergehend nicht verfügbar",
    "parking.stale": "Parkplatzdaten sind möglicherweise veraltet",
    'controls.locate': 'Zu meinem Standort',
    'controls.refresh': 'Scooter aktualisieren',
    'controls.zoomGroup': 'Kartenzoom',
    'controls.zoomIn': 'Vergrössern',
    'controls.zoomOut': 'Verkleinern',
    'intro.title': 'Scooter in der Nähe finden',
    'intro.body': 'Finde Scooter in deiner Nähe und sieh, wie weit sie entfernt sind.',
    'intro.useLocation': 'Meinen Standort nutzen',
    'intro.browse': 'Karte erkunden',
    'sheet.region': 'Steuerung der Scootersuche',
    'sheet.expand': 'Steuerung öffnen',
    'sheet.collapse': 'Steuerung schliessen',
    'sheet.updating': 'Wird aktualisiert…',
    'sheet.finding': 'Scooter werden gesucht…',
    'sheet.updated': 'Aktualisiert um {time}',
    'sheet.justNow': 'Gerade eben',
    'sheet.minutesAgo': 'vor {count} Min.',
    'sheet.onMap': 'auf dieser Karte',
    'sheet.scooter': 'Scooter',
    'sheet.scooters': 'Scooter',
    'providers.filter': 'Scooter nach Anbieter filtern',
    'providers.all': 'Alle',
    'providers.allLabel': 'Alle Anbieter, {count}. Alle anzeigen.',
    'providers.showAll': 'Alle Anbieter anzeigen',
    'providers.toggleLabel': '{name}, {count}. {state}.',
    'providers.selected': 'Eingeblendet',
    'providers.notSelected': 'Ausgeblendet',
    'filters.title': 'Filter',
    'filters.minBattery': 'Mindestakku',
    'filters.any': 'Beliebig',
    'filters.reset': 'Filter zurücksetzen',
    'filters.active': 'Filter aktiv',
    'filters.unknownBattery': 'Scooter ohne Akkuangabe werden ausgeblendet.',
    'settings.title': 'Einstellungen & Karte',
    'map.style': 'Kartenstil',
    'map.light': 'Hell',
    'map.dark': 'Dunkel',
    'map.osm': 'OSM',
    'map.credits': 'Karten- & Datenquellen',
    'language.title': 'Sprache',
    'status.updatingLocation': 'Standort wird aktualisiert…',
    'status.refreshed': 'Scooter aktualisiert',
    'status.retry': 'Erneut versuchen',
    'errors.fetchScooters': 'Scooter konnten nicht geladen werden',
    'errors.locationDenied': 'Der Standortzugriff ist deaktiviert. Du kannst weiterhin suchen oder die Karte durchsuchen.',
    'errors.locationUnavailable': 'Dein Standort ist vorübergehend nicht verfügbar. Bitte versuche es erneut.',
    'data.overview': 'Stadtübersicht · stündlich aktualisiert',
    'data.cached': 'Zwischengespeicherte Daten werden angezeigt',
    'data.partial': 'Einige Anbieter sind nicht verfügbar',
    'data.truncated': '{shown} von {total} Ergebnissen werden angezeigt',
    'marker.scooter': '{name}-Scooter',
    'marker.scooterAway': '{name}-Scooter, {distance} entfernt',
    'marker.walkThere': 'Zu Fuss hin',
    'marker.openIn': 'In {name} öffnen',
    'marker.app': 'App',
    'marker.close': 'Scooter-Details schliessen',
    'marker.cluster': '{count} Scooter: {providers}. Zum Trennen vergrössern.',
    'marker.yourLocation': 'Dein aktueller Standort',
    'marker.searchedAddress': 'Gesuchte Adresse: {name}',
    'distance.meters': '{count} m',
    'distance.kilometers': '{count} km',
    'search.title': 'Adresssuche',
    'search.placeholder': 'Stadt oder Schweizer Adresse',
    'search.clear': 'Adresssuche löschen',
    'search.loading': 'Suche läuft…',
    'search.noResults': 'Keine Adressen oder Städte gefunden',
    'search.error': 'Die Adresssuche ist nicht verfügbar',
    'search.results': 'Adressvorschläge',
    'empty.filtered': 'Hier passen keine Scooter zu diesen Filtern.',
    'empty.area': 'In diesem Kartenausschnitt sind keine Scooter verfügbar.',
    'links.privacy': 'Datenschutz',
  },
  fr: {
    "common.done": "Terminé",
    "search.chooseOrigin": "Choisir un point de départ",
    "search.currentLocation": "Position actuelle",
    "search.change": "Rechercher ou changer de départ",
    "search.changeOrigin": "Départ : {name}. Rechercher ou changer de départ.",
    "search.nearby": "Rechercher à proximité",
    "settings.more": "Plus d’options",
    "providers.title": "Opérateurs",
    "sheet.scooterOnMap": "trottinette sur la carte",
    "sheet.scootersOnMap": "trottinettes sur la carte",
    "marker.walk": "à pied",
    "parking.label": "Stationnement {name} : {place}",
    "parking.required": "Le stationnement dans les emplacements désignés est obligatoire dans cette zone.",
    "parking.designated": "Emplacement de stationnement pour trottinettes.",
    "parking.check": "Vérifiez dans l’application de l’opérateur que vous pouvez terminer votre trajet ici.",
    "parking.directions": "Itinéraire vers le stationnement",
    "parking.unavailable": "Les données de stationnement sont temporairement indisponibles",
    "parking.stale": "Les données de stationnement peuvent être anciennes",
    'controls.locate': 'Aller à ma position',
    'controls.refresh': 'Actualiser les trottinettes',
    'controls.zoomGroup': 'Zoom de la carte',
    'controls.zoomIn': 'Zoomer',
    'controls.zoomOut': 'Dézoomer',
    'intro.title': 'Trouver une trottinette',
    'intro.body': 'Trouvez les trottinettes à proximité et voyez à quelle distance elles se trouvent.',
    'intro.useLocation': 'Utiliser ma position',
    'intro.browse': 'Explorer la carte',
    'sheet.region': 'Commandes de recherche de trottinettes',
    'sheet.expand': 'Développer les commandes',
    'sheet.collapse': 'Réduire les commandes',
    'sheet.updating': 'Actualisation…',
    'sheet.finding': 'Recherche de trottinettes…',
    'sheet.updated': 'Actualisé à {time}',
    'sheet.justNow': "À l’instant",
    'sheet.minutesAgo': 'il y a {count} min',
    'sheet.onMap': 'sur cette carte',
    'sheet.scooter': 'trottinette',
    'sheet.scooters': 'trottinettes',
    'providers.filter': 'Filtrer les trottinettes par opérateur',
    'providers.all': 'Tous',
    'providers.allLabel': 'Tous les opérateurs, {count}. Tout afficher.',
    'providers.showAll': 'Afficher tous les opérateurs',
    'providers.toggleLabel': '{name}, {count}. {state}.',
    'providers.selected': 'Affiché',
    'providers.notSelected': 'Masqué',
    'filters.title': 'Filtres',
    'filters.minBattery': 'Batterie min.',
    'filters.any': 'Indifférent',
    'filters.reset': 'Réinitialiser les filtres',
    'filters.active': 'Filtres actifs',
    'filters.unknownBattery': 'Les trottinettes sans niveau de batterie sont masquées.',
    'settings.title': 'Réglages et carte',
    'map.style': 'Style de carte',
    'map.light': 'Clair',
    'map.dark': 'Sombre',
    'map.osm': 'OSM',
    'map.credits': 'Crédits de la carte et des données',
    'language.title': 'Langue',
    'status.updatingLocation': 'Actualisation de la position…',
    'status.refreshed': 'Trottinettes actualisées',
    'status.retry': 'Réessayer',
    'errors.fetchScooters': 'Impossible de charger les trottinettes',
    'errors.locationDenied': "L’accès à la position est désactivé. Vous pouvez toujours rechercher ou parcourir la carte.",
    'errors.locationUnavailable': 'Votre position est temporairement indisponible. Veuillez réessayer.',
    'data.overview': 'Totaux par ville · actualisés chaque heure',
    'data.cached': 'Données en cache affichées',
    'data.partial': 'Certains opérateurs sont indisponibles',
    'data.truncated': 'Affichage de {shown} résultats sur {total}',
    'marker.scooter': 'Trottinette {name}',
    'marker.scooterAway': 'Trottinette {name}, à {distance}',
    'marker.walkThere': 'Itinéraire à pied',
    'marker.openIn': 'Ouvrir dans {name}',
    'marker.app': 'l’app',
    'marker.close': 'Fermer les détails',
    'marker.cluster': '{count} trottinettes : {providers}. Zoomez pour les séparer.',
    'marker.yourLocation': 'Votre position actuelle',
    'marker.searchedAddress': 'Adresse recherchée : {name}',
    'distance.meters': '{count} m',
    'distance.kilometers': '{count} km',
    'search.title': 'Recherche d’adresse',
    'search.placeholder': 'Ville ou adresse suisse',
    'search.clear': 'Effacer la recherche d’adresse',
    'search.loading': 'Recherche…',
    'search.noResults': 'Aucune adresse ou ville trouvée',
    'search.error': "La recherche d’adresse est indisponible",
    'search.results': 'Suggestions d’adresses',
    'empty.filtered': 'Aucune trottinette ne correspond à ces filtres ici.',
    'empty.area': 'Aucune trottinette dans cette zone de la carte.',
    'links.privacy': 'Confidentialité',
  },
  it: {
    "common.done": "Fine",
    "search.chooseOrigin": "Scegli un punto di partenza",
    "search.currentLocation": "Posizione attuale",
    "search.change": "Cerca o cambia punto di partenza",
    "search.changeOrigin": "Partenza: {name}. Cerca o cambia punto di partenza.",
    "search.nearby": "Cerca nelle vicinanze",
    "settings.more": "Altre opzioni",
    "providers.title": "Operatori",
    "sheet.scooterOnMap": "monopattino sulla mappa",
    "sheet.scootersOnMap": "monopattini sulla mappa",
    "marker.walk": "a piedi",
    "parking.label": "Parcheggio {name}: {place}",
    "parking.required": "In questa zona è obbligatorio usare gli spazi di parcheggio designati.",
    "parking.designated": "Parcheggio riservato ai monopattini.",
    "parking.check": "Verifica nell’app dell’operatore di poter terminare la corsa qui.",
    "parking.directions": "Indicazioni per il parcheggio",
    "parking.unavailable": "Dati sui parcheggi temporaneamente non disponibili",
    "parking.stale": "I dati sui parcheggi potrebbero non essere aggiornati",
    'controls.locate': 'Vai alla mia posizione',
    'controls.refresh': 'Aggiorna i monopattini',
    'controls.zoomGroup': 'Zoom della mappa',
    'controls.zoomIn': 'Ingrandisci',
    'controls.zoomOut': 'Riduci',
    'intro.title': 'Trova un monopattino vicino',
    'intro.body': 'Trova i monopattini nelle vicinanze e scopri quanto distano.',
    'intro.useLocation': 'Usa la mia posizione',
    'intro.browse': 'Esplora la mappa',
    'sheet.region': 'Comandi di ricerca dei monopattini',
    'sheet.expand': 'Espandi i comandi',
    'sheet.collapse': 'Comprimi i comandi',
    'sheet.updating': 'Aggiornamento…',
    'sheet.finding': 'Ricerca dei monopattini…',
    'sheet.updated': 'Aggiornato alle {time}',
    'sheet.justNow': 'Adesso',
    'sheet.minutesAgo': '{count} min fa',
    'sheet.onMap': 'su questa mappa',
    'sheet.scooter': 'monopattino',
    'sheet.scooters': 'monopattini',
    'providers.filter': 'Filtra i monopattini per operatore',
    'providers.all': 'Tutti',
    'providers.allLabel': 'Tutti gli operatori, {count}. Mostra tutti.',
    'providers.showAll': 'Mostra tutti gli operatori',
    'providers.toggleLabel': '{name}, {count}. {state}.',
    'providers.selected': 'Visibile',
    'providers.notSelected': 'Nascosto',
    'filters.title': 'Filtri',
    'filters.minBattery': 'Batteria min.',
    'filters.any': 'Qualsiasi',
    'filters.reset': 'Reimposta filtri',
    'filters.active': 'Filtri attivi',
    'filters.unknownBattery': 'I monopattini senza dati sulla batteria sono nascosti.',
    'settings.title': 'Impostazioni e mappa',
    'map.style': 'Stile mappa',
    'map.light': 'Chiaro',
    'map.dark': 'Scuro',
    'map.osm': 'OSM',
    'map.credits': 'Fonti della mappa e dei dati',
    'language.title': 'Lingua',
    'status.updatingLocation': 'Aggiornamento della posizione…',
    'status.refreshed': 'Monopattini aggiornati',
    'status.retry': 'Riprova',
    'errors.fetchScooters': 'Impossibile caricare i monopattini',
    'errors.locationDenied': 'L’accesso alla posizione è disattivato. Puoi comunque cercare o esplorare la mappa.',
    'errors.locationUnavailable': 'La tua posizione è temporaneamente non disponibile. Riprova.',
    'data.overview': 'Totali per città · aggiornati ogni ora',
    'data.cached': 'Visualizzazione dei dati nella cache',
    'data.partial': 'Alcuni operatori non sono disponibili',
    'data.truncated': 'Visualizzazione di {shown} risultati su {total}',
    'marker.scooter': 'Monopattino {name}',
    'marker.scooterAway': 'Monopattino {name}, a {distance}',
    'marker.walkThere': 'Vai a piedi',
    'marker.openIn': 'Apri in {name}',
    'marker.app': 'app',
    'marker.close': 'Chiudi i dettagli',
    'marker.cluster': '{count} monopattini: {providers}. Ingrandisci per separarli.',
    'marker.yourLocation': 'La tua posizione attuale',
    'marker.searchedAddress': 'Indirizzo cercato: {name}',
    'distance.meters': '{count} m',
    'distance.kilometers': '{count} km',
    'search.title': 'Ricerca indirizzo',
    'search.placeholder': 'Città o indirizzo svizzero',
    'search.clear': 'Cancella la ricerca indirizzo',
    'search.loading': 'Ricerca…',
    'search.noResults': 'Nessun indirizzo o città trovato',
    'search.error': 'La ricerca indirizzo non è disponibile',
    'search.results': 'Suggerimenti di indirizzi',
    'empty.filtered': 'Nessun monopattino corrisponde a questi filtri qui.',
    'empty.area': 'Nessun monopattino in questa zona della mappa.',
    'links.privacy': 'Privacy',
  },
};

type TranslationValues = Record<string, string | number>;

interface I18nContextValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);
const LOCALE_STORAGE_KEY = 'scooters-locale';

function supportedLocale(value: string | null | undefined): AppLocale | null {
  if (!value) return null;
  const language = value.toLowerCase().split('-')[0];
  return SUPPORTED_LOCALES.find((locale) => locale === language) ?? null;
}

function browserLocale(): AppLocale {
  const requested = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  for (const locale of requested) {
    const supported = supportedLocale(locale);
    if (supported) return supported;
  }
  return 'en';
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>('en');

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      } catch {}
      setLocaleState(supportedLocale(stored) ?? browserLocale());
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    document.documentElement.lang = `${locale}-CH`;
  }, [locale]);

  const setLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {}
  }, []);

  const t = useCallback((key: TranslationKey, values: TranslationValues = {}) => {
    const template = dictionaries[locale][key];
    return Object.entries(values).reduce(
      (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
      template
    );
  }, [locale]);

  const formatNumber = useCallback(
    (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(`${locale}-CH`, options).format(value),
    [locale]
  );

  const value = useMemo(
    () => ({ locale, setLocale, t, formatNumber }),
    [formatNumber, locale, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
