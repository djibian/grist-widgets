(() => {
  'use strict';

  // -------------------------------------------------------------------------
  // RÉGLAGES — modifiez uniquement ces valeurs si nécessaire, puis sauvegardez
  // -------------------------------------------------------------------------
  const DOMICILE_LATITUDE = 47.057944;
  const DOMICILE_LONGITUDE = -1.521611;
  const ITINERAIRE = 'fastest'; // 'fastest' = plus rapide ; 'shortest' = plus court
  const NOMBRE_DECIMALES = 2;   // distance enregistrée en kilomètres

  const API_URL = 'https://data.geopf.fr/navigation/itineraire';

  const elements = Object.fromEntries([
    'mappingError',
    'appCard',
    'recordTitle',
    'recordAddress',
    'distanceValue',
    'durationValue',
    'calculateSelected',
    'status'
  ].map((id) => [id, document.getElementById(id)]));

  const state = {
    selected: null,
    mappings: null,
    busy: false
  };

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function validCoordinates(latitude, longitude) {
    return isFiniteNumber(latitude) &&
      isFiniteNumber(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180;
  }

  function displayText(value, fallback) {
    if (value === null || value === undefined) return fallback;

    const text = String(value).trim();
    return text || fallback;
  }

  function mappingIsComplete() {
    return Boolean(
      state.mappings &&
      state.mappings.NomPrenom &&
      state.mappings.Adresse &&
      state.mappings.Latitude &&
      state.mappings.Longitude &&
      state.mappings.Distance
    );
  }

  function setStatus(message, type = '') {
    elements.status.textContent = message;
    elements.status.className = 'status' + (type ? ' ' + type : '');
  }

  function setBusy(busy) {
    state.busy = busy;

    elements.calculateSelected.disabled =
      busy ||
      !state.selected ||
      !mappingIsComplete() ||
      !validCoordinates(
        state.selected.Latitude,
        state.selected.Longitude
      );
  }

  function renderSelected() {
    const row = state.selected;

    if (!row) {
      elements.recordTitle.textContent = 'Sélectionnez une ligne';
      elements.recordAddress.textContent = 'L’adresse apparaîtra ici.';
      elements.distanceValue.textContent = '—';
      elements.durationValue.textContent = '';
      elements.calculateSelected.disabled = true;
      return;
    }

    elements.recordTitle.textContent = displayText(
      row.NomPrenom,
      'Nom non renseigné'
    );

    elements.recordAddress.textContent = displayText(
      row.Adresse,
      'Adresse non renseignée'
    );

    elements.distanceValue.textContent = isFiniteNumber(row.Distance)
      ? row.Distance.toLocaleString('fr-FR', {
          maximumFractionDigits: 3
        })
      : '—';

    elements.durationValue.textContent = isFiniteNumber(row.Duree)
      ? Math.round(row.Duree) + ' min'
      : '';

    setBusy(state.busy);
  }

  function renderMappingState() {
    const configured = mappingIsComplete();

    elements.mappingError.classList.toggle(
      'visible',
      !configured
    );

    elements.appCard.style.display = configured ? '' : 'none';

    if (configured) {
      renderSelected();
    }
  }

  function wait(milliseconds) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, milliseconds);
    });
  }

  async function requestRoute(latitude, longitude, attempt = 0) {
    const payload = {
      resource: 'bdtopo-osrm',
      start: DOMICILE_LONGITUDE + ',' + DOMICILE_LATITUDE,
      end: longitude + ',' + latitude,
      profile: 'car',
      optimization:
        ITINERAIRE === 'shortest' ? 'shortest' : 'fastest',
      geometryFormat: 'geojson',
      getSteps: false,
      getBbox: false,
      distanceUnit: 'kilometer',
      timeUnit: 'minute',
      crs: 'EPSG:4326'
    };

    let response;

    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (_) {
      throw new Error(
        'Impossible de joindre le service IGN. Vérifiez la connexion réseau.'
      );
    }

    if (response.status === 429 && attempt < 3) {
      const retryAfter = Math.max(
        1,
        Number(response.headers.get('retry-after')) || 2
      );

      await wait(retryAfter * 1000);

      return requestRoute(
        latitude,
        longitude,
        attempt + 1
      );
    }

    let data = null;

    try {
      data = await response.json();
    } catch (_) {
      // Une éventuelle erreur HTTP non JSON sera traitée ci-dessous.
    }

    if (!response.ok) {
      const apiMessage =
        data &&
        data.error &&
        data.error.message
          ? data.error.message
          : data && data.message;

      throw new Error(
        apiMessage ||
        'Le service IGN a répondu avec l’erreur HTTP ' +
          response.status +
          '.'
      );
    }

    if (!isFiniteNumber(data && data.distance)) {
      throw new Error(
        'Aucun itinéraire routier n’a été trouvé pour ces coordonnées.'
      );
    }

    const decimals = [0, 1, 2, 3].includes(NOMBRE_DECIMALES)
      ? NOMBRE_DECIMALES
      : 2;

    return {
      distance: Number(
        data.distance.toFixed(decimals)
      ),

      duration: isFiniteNumber(data.duration)
        ? Number(data.duration.toFixed(1))
        : null
    };
  }

  function fieldsFor(result) {
    const fields = {
      [state.mappings.Distance]: result.distance
    };

    if (
      state.mappings.Duree &&
      isFiniteNumber(result.duration)
    ) {
      fields[state.mappings.Duree] = result.duration;
    }

    return fields;
  }

  async function calculateSelected() {
    if (
      !state.selected ||
      state.busy ||
      !validCoordinates(
        state.selected.Latitude,
        state.selected.Longitude
      )
    ) {
      return;
    }

    setBusy(true);
    setStatus('Calcul de l’itinéraire…');

    try {
      const result = await requestRoute(
        state.selected.Latitude,
        state.selected.Longitude
      );

      const table = grist.getTable();

      await table.update({
        id: state.selected.id,
        fields: fieldsFor(result)
      });

      state.selected.Distance = result.distance;
      state.selected.Duree = result.duration;

      renderSelected();

      setStatus(
        'Distance enregistrée dans Grist.',
        'success'
      );
    } catch (error) {
      setStatus(
        error && error.message
          ? error.message
          : String(error),
        'error'
      );
    } finally {
      setBusy(false);
    }
  }

  elements.calculateSelected.addEventListener(
    'click',
    calculateSelected
  );

  /*
   * Les associations restent techniquement optionnelles pour préserver
   * l’état du Custom Widget Builder pendant sa configuration.
   *
   * Le widget exige néanmoins les cinq associations principales avant
   * d’afficher son contenu.
   */
  grist.ready({
    requiredAccess: 'full',

    columns: [
      {
        name: 'NomPrenom',
        title: 'Nom et prénom',
        type: 'Text',
        optional: true,
        description:
          'Nom et prénom affichés pour la ligne sélectionnée.'
      },
      {
        name: 'Adresse',
        title: 'Adresse normalisée',
        type: 'Text',
        optional: true,
        description:
          'Adresse affichée sous le nom.'
      },
      {
        name: 'Latitude',
        title: 'Latitude de destination',
        type: 'Numeric,Int',
        optional: true,
        description:
          'Latitude décimale de l’élève.'
      },
      {
        name: 'Longitude',
        title: 'Longitude de destination',
        type: 'Numeric,Int',
        optional: true,
        description:
          'Longitude décimale de l’élève.'
      },
      {
        name: 'Distance',
        title: 'Distance routière (km)',
        type: 'Numeric,Int',
        optional: true,
        description:
          'Colonne ordinaire dans laquelle écrire la distance.'
      },
      {
        name: 'Duree',
        title: 'Durée estimée (min)',
        type: 'Numeric,Int',
        optional: true,
        description:
          'Colonne facultative pour enregistrer la durée.'
      }
    ]
  });

  grist.onRecord((record, mappings) => {
    state.mappings = mappings || null;

    state.selected = record
      ? grist.mapColumnNames(record, {mappings})
      : null;

    renderMappingState();
  });

  renderMappingState();
})();
